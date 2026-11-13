// Transaction engine: every state-changing API call is a `transactions` row, processed one at a
// time per signer (operator:<network> or wallet:<id>), different signers in parallel.
// Server-only; import dynamically inside handlers.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { openKey, sha256Hex } from "./crypto";
import { audit, rateLimit } from "./service.server";
import {
  MAX_RETRIES,
  WEBHOOK_MAX_AGE_MS,
  backoffMs,
  fromBaseUnits,
  idempotencyDecision,
  mapChainError,
  stableJson,
  submissionNeedsReconciliation,
  publicTransactionStatus,
  reconcileDecision,
  webhookBackoffMs,
} from "./chain-rules";

const db = supabaseAdmin;

export type TxRow = {
  id: string; app_id: string; network: string; type: string; status: string; idempotency_key: string;
  request: Record<string, unknown>; request_hash: string; result: Record<string, unknown> | null; signer_key: string;
  wallet_id: string | null; tx_hash: string | null; error_code: string | null; error_message: string | null;
  attempts: number; created_at: string; submitted_at: string | null; confirmed_at: string | null;
};

import { isGasFreeClass, LEGACY_CLASS_MESSAGE } from "./chain-rules";
export class EngineError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: Record<string, unknown>) {
    super(message ?? code);
  }
}

export function explorerUrl(network: string, hash: string | null) {
  if (!hash) return null;
  return `${network === "mainnet" ? "https://voyager.online" : "https://sepolia.voyager.online"}/tx/${hash}`;
}

export function txDto(t: TxRow) {
  const pub = { ...(t.request ?? {}) };
  delete (pub as Record<string, unknown>)["_r"];
  return {
    id: t.id,
    type: t.type,
    status: publicTransactionStatus(t.status, t.error_code),
    network: t.network,
    request: pub,
    txHash: t.tx_hash,
    explorerUrl: explorerUrl(t.network, t.tx_hash),
    result: t.result ?? {},
    error: t.error_code ? { code: t.error_code, message: t.error_message } : null,
    createdAt: t.created_at,
    submittedAt: t.submitted_at,
    confirmedAt: t.confirmed_at,
  };
}

/** Accept: idempotency check, insert as queued. `request._r` holds resolved addresses for the worker. */
export async function enqueue(p: {
  appId: string; network: string; type: string; idempotencyKey: string; signerKey: string | (() => Promise<string>); walletId?: string | null;
  request: Record<string, unknown>; resolved: Record<string, unknown>;
}) {
  const requestHash = await sha256Hex(stableJson({ type: p.type, network: p.network, ...p.request }));
  const { data: existing } = await db.from("transactions").select("*").eq("app_id", p.appId).eq("idempotency_key", p.idempotencyKey).maybeSingle();
  const d = idempotencyDecision(existing as TxRow | null, requestHash);
  if (d === "replay") return { tx: existing as unknown as TxRow, replay: true };
  if (d === "conflict") throw new EngineError(409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different request");
  const signerKey = typeof p.signerKey === "function" ? await p.signerKey() : p.signerKey;
  const { data, error } = await db
    .from("transactions")
    .insert({
      app_id: p.appId, network: p.network, type: p.type, idempotency_key: p.idempotencyKey, request_hash: requestHash,
      request: { ...p.request, _r: p.resolved } as never, signer_key: signerKey, wallet_id: p.walletId ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await db.from("transactions").select("*").eq("app_id", p.appId).eq("idempotency_key", p.idempotencyKey).single();
      return { tx: again as unknown as TxRow, replay: true };
    }
    throw error;
  }
  await audit({ app_id: p.appId, wallet_id: p.walletId ?? null, action: `tx_queued:${p.type}`, details: { transaction_id: data.id } });
  return { tx: data as unknown as TxRow, replay: false };
}

export async function getTx(id: string) {
  const { data } = await db.from("transactions").select("*").eq("id", id).maybeSingle();
  return data as unknown as TxRow | null;
}

async function walletSigner(walletId: string) {
  const { data: w } = await db.from("wallets").select("id,address,public_key,class_hash,encrypted_private_key,deployed").eq("id", walletId).single();
  if (!isGasFreeClass(w!.class_hash)) throw new Error(LEGACY_CLASS_MESSAGE);
  return { w: w!, signer: { address: w!.address, publicKey: w!.public_key, classHash: w!.class_hash, privateKey: await openKey(w!.encrypted_private_key) } };
}

/** Build + submit one claimed transaction. Returns quickly once the chain has the tx hash. */
async function execute(t: TxRow) {
  const core = await import("./core/core");
  const r = (t.request["_r"] ?? {}) as Record<string, string>;
  const net = t.network;
  let txHash: string | null = null;
  let result: Record<string, unknown> = {};

  if (t.signer_key.startsWith("operator:")) {
    let out: Record<string, unknown> = {};
    switch (t.type) {
      case "token.create": out = await core.relay(net, "create-token", { name: r["name"], symbol: r["symbol"], initialSupply: r["amountRaw"] }, t.id); break;
      case "token.mint": out = await core.relay(net, "mint-more", { token: r["token"], amount: r["amountRaw"] }, t.id); break;
      case "token.distribute": out = await core.relay(net, "distribute", { token: r["token"], to: r["to"], amount: r["amountRaw"] }, t.id); break;
      case "collection.create":
        out = await core.relay(net, "nft/create-collection", { creator: r["creator"], name: r["name"], symbol: r["symbol"], royaltyReceiver: r["royaltyReceiver"], royaltyBps: Number(r["royaltyBps"] ?? 0) }, t.id);
        break;
      case "nft.mint":
        out = await core.relay(net, "nft/mint", { collectionAddress: r["collection"], to: r["to"], tokenUri: r["tokenUri"], attributes: t.request["attributes"] ?? [], media: t.request["media"] ?? [] }, t.id);
        break;
      default: throw new Error(`unknown operator action ${t.type}`);
    }
    // Admin self-test: act as if the reply never arrived. The relay really sent it and recorded it, so the recovery pass must find it.
    if (t.request["_test"] === "drop_reply" && t.attempts <= 1) throw Object.assign(new Error("self-test: the reply was dropped on purpose"), { code: "SUBMISSION_UNKNOWN" });
    txHash = (out["transactionHash"] ?? out["txHash"] ?? null) as string | null;
    result = { relay: { tokenAddress: out["tokenAddress"] ?? out["token"] ?? null, collectionAddress: out["collectionAddress"] ?? null, tokenId: out["tokenId"] ?? null } };
  } else {
    const { signer, w } = await walletSigner(t.wallet_id!);
    const b = core.builders(net);
    let calls;
    switch (t.type) {
      case "transfer": calls = b.transferToken(r["token"]!, r["to"]!, BigInt(r["amountRaw"]!)); break;
      case "return": calls = b.returnTokens(r["token"]!, BigInt(r["amountRaw"]!)); break;
      case "swap": calls = b.swap(r["fromToken"]!, r["toToken"]!, BigInt(r["amountRaw"]!)); break;
      case "nft.transfer": calls = b.transferNft(r["collection"]!, w.address, r["to"]!, BigInt(r["tokenId"]!)); break;
      case "nft.update": {
        const id = BigInt(r["tokenId"]!);
        calls = [
          ...(t.request["tokenUri"] ? b.setTokenUri(r["collection"]!, id, String(t.request["tokenUri"])) : []),
          ...(Array.isArray(t.request["attributes"]) && (t.request["attributes"] as unknown[]).length ? b.setAttributes(r["collection"]!, id, t.request["attributes"] as never) : []),
          ...(Array.isArray(t.request["media"]) && (t.request["media"] as unknown[]).length ? b.setMedia(r["collection"]!, id, t.request["media"] as never) : []),
        ];
        break;
      }
      case "nft.freeze": calls = b.freezeToken(r["collection"]!, BigInt(r["tokenId"]!)); break;
      case "collection.freeze": calls = b.freezeCollection(r["collection"]!); break;
      case "collection.royalty": calls = b.setRoyalty(r["collection"]!, r["receiver"]!, Number(r["bps"])); break;
      case "collection.minter.add": calls = b.addMinter(r["collection"]!, r["minter"]!); break;
      case "collection.minter.remove": calls = b.removeMinter(r["collection"]!, r["minter"]!); break;
      default: throw new Error(`unknown wallet action ${t.type}`);
    }
    if (!calls.length) throw Object.assign(new Error("nothing to change"), { code: "VALIDATION" });
    const sent = await core.send(net, signer, calls);
    signer.privateKey = "";
    txHash = sent.transactionHash;
    result = { deployedNow: sent.deployedNow };
    await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: "wallet_signed", details: { transaction_id: t.id, type: t.type, tx_hash: txHash } });
  }

  if (txHash) {
    const { error } = await db.from("transactions").update({ status: "submitted", tx_hash: txHash, submitted_at: new Date().toISOString(), result: result as never, error_code: null, error_message: null }).eq("id", t.id);
    if (error) {
      console.error("submission_record_error", { requestId: t.id, txHash, message: error.message });
      throw Object.assign(new Error("Transaction sent but its record could not be saved; check the chain before retrying"), { code: "SUBMISSION_UNKNOWN" });
    }
  } else {
    throw Object.assign(new Error("No transaction hash received; check the chain before retrying"), { code: "SUBMISSION_UNKNOWN" });
  }
}

async function fail(t: TxRow, err: unknown) {
  const msg = String((err as Error)?.message ?? err).slice(0, 500);
  let mapped = mapChainError(msg, t.type);
  if ((err as { code?: string })?.code === "VALIDATION") mapped = { code: "VALIDATION", status: 400, retry: false };
  if ((err as { code?: string })?.code === "REJECTED") mapped = { code: "REJECTED", status: 422, retry: false };
  if (t.type === "swap" && mapped.code === "INSUFFICIENT_BALANCE_OR_LIQUIDITY") {
    try {
      const core = await import("./core/core");
      const r = t.request["_r"] as Record<string, string>;
      const fb = await core.readers(t.network).factoryBalance(r["toToken"]!);
      mapped = { ...mapped, code: BigInt(fb) < BigInt(r["amountRaw"]!) ? "INSUFFICIENT_LIQUIDITY" : "INSUFFICIENT_BALANCE" };
    } catch { mapped = { ...mapped, code: "INSUFFICIENT_BALANCE" }; }
  }
  if (submissionNeedsReconciliation((err as { code?: string })?.code, mapped.retry)) {
    // "unknown" is its own status: it no longer holds the signer's queue, and the recovery pass works on it.
    await db.from("transactions").update({ status: "unknown", error_code: "SUBMISSION_UNKNOWN", error_message: "Outcome not yet known; the hub is checking. " + msg }).eq("id", t.id);
    await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: "tx_submission_unknown", details: { transaction_id: t.id, error: msg } });
    return;
  }
  const { data } = await db.from("transactions").update({ status: "failed", error_code: mapped.code, error_message: msg }).eq("id", t.id).select("*").single();
  await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: `tx_failed:${t.type}`, details: { transaction_id: t.id, code: mapped.code } });
  if (data) await queueWebhook(data as unknown as TxRow);
}

/** Apply confirmed effects to our bookkeeping tables. Chain stays the source of truth. */
async function finalize(t: TxRow, events: { from_address: string; keys: string[] }[]) {
  const core = await import("./core/core");
  const r = (t.request["_r"] ?? {}) as Record<string, string>;
  const relayOut = ((t.result ?? {})["relay"] ?? {}) as Record<string, string | null>;
  const result: Record<string, unknown> = { ...(t.result ?? {}) };
  delete result["relay"];
  const c = core.cfg(t.network);
  switch (t.type) {
    case "token.create": {
      const address = relayOut["tokenAddress"] ?? core.addressFromEvents(events, c.tokenFactory);
      let { data } = await db.from("tokens").insert({ app_id: t.app_id, network: t.network, address, name: r["name"]!, symbol: r["symbol"]!, swappable: r["swappable"] === "true", created_tx: t.id }).select("id").single();
      if (!data && address) data = (await db.from("tokens").select("id").eq("network", t.network).eq("address", address).maybeSingle()).data; // finalize being retried
      Object.assign(result, { tokenId: data?.id, address });
      break;
    }
    case "collection.create": {
      const address = relayOut["collectionAddress"] ?? core.addressFromEvents(events, c.nftFactory);
      let { data } = await db.from("collections").insert({
        app_id: t.app_id, network: t.network, address, name: r["name"]!, symbol: r["symbol"]!, owner_wallet_id: r["ownerWalletId"]!,
        royalty_receiver: r["royaltyReceiver"] ?? null, royalty_bps: Number(r["royaltyBps"] ?? 0), created_tx: t.id,
      }).select("id").single();
      if (!data && address) data = (await db.from("collections").select("id").eq("network", t.network).eq("address", address).maybeSingle()).data; // finalize being retried
      Object.assign(result, { collectionId: data?.id, address });
      break;
    }
    case "nft.mint": {
      const tokenId = relayOut["tokenId"] != null ? String(relayOut["tokenId"]) : core.mintedTokenId(events, r["collection"]!);
      if (tokenId) {
        await db.from("nfts").upsert({
          collection_id: r["collectionId"]!, token_id: tokenId, owner_address: r["to"]!, owner_wallet_id: r["toWalletId"] || null,
          token_uri: r["tokenUri"] ?? null, attributes: (t.request["attributes"] ?? []) as never, media: (t.request["media"] ?? []) as never, minted_tx: t.id,
        }, { onConflict: "collection_id,token_id" });
      }
      Object.assign(result, { tokenId });
      break;
    }
    case "nft.transfer":
      await db.from("nfts").update({ owner_address: r["to"]!, owner_wallet_id: r["toWalletId"] || null, updated_at: new Date().toISOString() }).eq("collection_id", r["collectionId"]!).eq("token_id", r["tokenId"]!);
      break;
    case "nft.update": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (t.request["tokenUri"]) patch["token_uri"] = t.request["tokenUri"];
      if (t.request["attributes"]) {
        // set_attributes upserts by key on chain, so merge rather than replace.
        const { data: cur } = await db.from("nfts").select("attributes").eq("collection_id", r["collectionId"]!).eq("token_id", r["tokenId"]!).maybeSingle();
        const merged = new Map(((cur?.attributes ?? []) as { key: string; value: unknown }[]).map((a) => [a.key, a]));
        for (const a of t.request["attributes"] as { key: string; value: unknown }[]) merged.set(a.key, a);
        patch["attributes"] = [...merged.values()];
      }
      if (t.request["media"]) patch["media"] = t.request["media"];
      await db.from("nfts").update(patch as never).eq("collection_id", r["collectionId"]!).eq("token_id", r["tokenId"]!);
      break;
    }
    case "nft.freeze":
      await db.from("nfts").update({ frozen: true }).eq("collection_id", r["collectionId"]!).eq("token_id", r["tokenId"]!);
      break;
    case "collection.freeze":
      await db.from("collections").update({ frozen: true }).eq("id", r["collectionId"]!);
      await db.from("nfts").update({ frozen: true }).eq("collection_id", r["collectionId"]!);
      break;
    case "collection.royalty":
      await db.from("collections").update({ royalty_receiver: r["receiver"]!, royalty_bps: Number(r["bps"]) }).eq("id", r["collectionId"]!);
      break;
  }
  if (t.wallet_id) await db.from("wallets").update({ deployed: true }).eq("id", t.wallet_id);
  if (r["amountRaw"]) result["amountRaw"] = r["amountRaw"];
  if (r["amountRaw"]) result["amount"] = fromBaseUnits(r["amountRaw"]);
  const { data } = await db.from("transactions").update({ status: "confirmed", error_code: null, error_message: null, confirmed_at: new Date().toISOString(), result: result as never }).eq("id", t.id).select("*").single();
  await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: `tx_confirmed:${t.type}`, details: { transaction_id: t.id, tx_hash: t.tx_hash } });
  if (data) await queueWebhook(data as unknown as TxRow);
}

async function checkSubmitted(t: TxRow) {
  const core = await import("./core/core");
  if (!t.tx_hash) return;
  const rec = await core.receiptStatus(t.network, t.tx_hash);
  if (!rec) {
    if (t.status === "submitted" && Date.now() - new Date(t.submitted_at ?? t.created_at).getTime() > 15 * 60_000) {
      await db.from("transactions").update({ status: "unknown", error_code: "SUBMISSION_UNKNOWN", error_message: "No receipt after 15 minutes; still checking the chain. Do not resend." }).eq("id", t.id).eq("status", "submitted");
    }
    return;
  }
  // Many workers can see the same receipt at once (every API call runs one). Exactly one wins this update and
  // applies the effects; the rest stop here, so nothing is recorded or sent twice.
  const { data: locked } = await db.from("transactions").update({ status: "finalizing", next_attempt_at: new Date().toISOString() }).eq("id", t.id).eq("status", t.status).select("*").maybeSingle();
  if (!locked) return;
  const mine = locked as unknown as TxRow;
  try {
    if (rec.state === "reverted") {
      const m = mapChainError(rec.reason, mine.type);
      const { data } = await db.from("transactions").update({ status: "failed", error_code: m.code, error_message: rec.reason.slice(0, 500) }).eq("id", mine.id).select("*").single();
      if (data) await queueWebhook(data as unknown as TxRow);
      return;
    }
    await finalize(mine, rec.events);
  } catch (e) {
    await db.from("transactions").update({ status: t.status }).eq("id", mine.id).eq("status", "finalizing"); // try again next pass
    throw e;
  }
}

/**
 * Works out what happened to a transaction whose outcome was lost, and fixes it without a human whenever it can:
 *  - it has a hash: wait for its receipt;
 *  - it went through the relay: ask the relay's request log (attach the hash, mark a definite rejection, or
 *    resend ONLY if the relay proves it never started it);
 *  - anything else (wallet-signed, or sent before the log existed) stays "unknown" and the admin is emailed once.
 */
async function reconcileUnknown(t: TxRow) {
  const core = await import("./core/core");
  const ageMin = (Date.now() - Date.parse(t.created_at)) / 60_000;
  const needsHuman = async (why: string) => { if (ageMin > 10) await alertAdmins("unknown", `Transaction ${t.type} needs a decision`, `Transaction ${t.id} (${t.type}) has an unknown outcome and the hub could not settle it itself: ${why}. Open Admin > Issues.`); };
  if (t.tx_hash) { await checkSubmitted(t); return; }
  if (!t.signer_key.startsWith("operator:")) { await needsHuman("it was signed from a user's wallet, which has no request log to ask"); return; }
  let lookup;
  try { lookup = await core.relayLookup(t.network, t.id); } catch { return; } // relay unreachable: try again next pass
  const d = reconcileDecision({ createdAt: t.created_at, attempts: t.attempts, lookup });
  if (d.action === "attach") {
    const { data } = await db.from("transactions").update({ status: "submitted", tx_hash: d.txHash, submitted_at: new Date().toISOString(), error_code: null, error_message: null }).eq("id", t.id).eq("status", "unknown").select("id").maybeSingle();
    if (data) await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: "tx_recovered", details: { transaction_id: t.id, tx_hash: d.txHash, via: "relay_log" } });
  } else if (d.action === "fail") {
    const m = mapChainError(d.message, t.type);
    const { data } = await db.from("transactions").update({ status: "failed", error_code: m.code === "CHAIN_ERROR" ? "REJECTED" : m.code, error_message: d.message.slice(0, 500) }).eq("id", t.id).eq("status", "unknown").select("*").maybeSingle();
    if (data) { await audit({ app_id: t.app_id, action: "tx_failed:" + t.type, details: { transaction_id: t.id, via: "relay_log" } }); await queueWebhook(data as unknown as TxRow); }
  } else if (d.action === "requeue") {
    const { data } = await db.from("transactions").update({ status: "queued", started_at: null, error_code: null, error_message: null, next_attempt_at: null }).eq("id", t.id).eq("status", "unknown").select("id").maybeSingle();
    if (data) await audit({ app_id: t.app_id, action: "tx_requeued", details: { transaction_id: t.id, reason: "relay confirmed it never started this request" } });
  } else await needsHuman(d.reason);
}

/** One worker pass: confirm submitted txs, recover stale claims, submit next per signer, deliver webhooks. */
export async function tick(opts: { maxClaims?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const stats = { checked: 0, submitted: 0, failed: 0, webhooks: 0 };

  // Anything the old rules left "stuck" with an unknown outcome moves to the "unknown" status, which frees its queue lane.
  await db.from("transactions").update({ status: "unknown" }).in("status", ["processing", "submitted"]).eq("error_code", "SUBMISSION_UNKNOWN");
  // A worker that claimed a transaction and then died before recording anything: the outcome is unknown, not "still running".
  await db.from("transactions").update({ status: "unknown", error_code: "SUBMISSION_UNKNOWN", error_message: "The worker stopped before recording a result; the hub is checking." })
    .eq("status", "processing").is("tx_hash", null).lt("started_at", new Date(Date.now() - 5 * 60_000).toISOString());
  // A worker that died mid-finalize leaves the row "finalizing"; hand it back after two minutes.
  await db.from("transactions").update({ status: "submitted" }).eq("status", "finalizing").lt("next_attempt_at", new Date(Date.now() - 2 * 60_000).toISOString());

  const { data: subs } = await db.from("transactions").select("*").eq("status", "submitted").order("submitted_at").limit(25);
  await Promise.allSettled(((subs ?? []) as unknown as TxRow[]).map(async (t) => { stats.checked++; await checkSubmitted(t); }));

  const { data: unk } = await db.from("transactions").select("*").eq("status", "unknown").order("created_at").limit(25);
  await Promise.allSettled(((unk ?? []) as unknown as TxRow[]).map((t) => reconcileUnknown(t)));

  if (Date.now() - started < budget) {
    const { data: claimed } = await db.rpc("claim_transactions", { _max: opts.maxClaims ?? 10 });
    await Promise.allSettled(((claimed ?? []) as unknown as TxRow[]).map(async (t) => {
      try { await execute(t); stats.submitted++; } catch (e) { stats.failed++; await fail(t, e); }
    }));
  }
  if (Date.now() - started < budget) stats.webhooks = await deliverWebhooks();
  return stats;
}

/** ?wait=true: keep ticking until this tx is final or ~45 s pass. */
export async function waitForTx(id: string, maxMs = 45_000) {
  const until = Date.now() + maxMs;
  let t = await getTx(id);
  while (t && !["confirmed", "failed", "cancelled", "unknown"].includes(t.status) && t.error_code !== "SUBMISSION_UNKNOWN" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    await tick({ maxClaims: 5, budgetMs: 8000 }).catch(() => undefined);
    t = await getTx(id);
  }
  return t;
}

/** Worker pass that keeps going: confirms, submits the next item per lane, repeats until the queue is empty or the budget is spent. */
export async function drain(opts: { budgetMs: number; maxClaims?: number; pauseMs?: number }) {
  const started = Date.now();
  const pause = opts.pauseMs ?? 2500;
  const total = { rounds: 0, checked: 0, submitted: 0, failed: 0, webhooks: 0 };
  while (total.rounds < 12) {
    const s = await tick({ maxClaims: opts.maxClaims ?? 40, budgetMs: 15_000 });
    total.rounds++; total.checked += s.checked; total.submitted += s.submitted; total.failed += s.failed; total.webhooks += s.webhooks;
    if (Date.now() - started + pause + 4000 > opts.budgetMs) break;
    const { count } = await db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["queued", "processing", "submitted", "finalizing"]);
    if (!count) break;
    await new Promise((r) => setTimeout(r, pause));
  }
  return total;
}

/** Admin decision on a transaction stuck as SUBMISSION_UNKNOWN (it blocks its signer lane until resolved). */
export async function resolveTransaction(id: string, action: "attach_hash" | "mark_failed" | "requeue", opts: { txHash?: string; note?: string }, admin: string) {
  const t = await getTx(id);
  if (!t) throw new EngineError(404, "NOT_FOUND", "transaction not found");
  if (!["processing", "submitted", "finalizing", "unknown"].includes(t.status)) throw new EngineError(409, "NOT_RESOLVABLE", `transaction is ${t.status}`);
  let next: Record<string, unknown>;
  if (action === "attach_hash") {
    if (!opts.txHash || !/^0x[0-9a-fA-F]{1,64}$/.test(opts.txHash)) throw new EngineError(400, "VALIDATION", "a transaction hash is required");
    next = { status: "submitted", tx_hash: opts.txHash, submitted_at: new Date().toISOString(), error_code: null, error_message: null };
  } else if (action === "requeue") {
    if (t.tx_hash) throw new EngineError(409, "NOT_RESOLVABLE", "this transaction has a hash; attach it instead of sending again");
    next = { status: "queued", started_at: null, error_code: null, error_message: null, next_attempt_at: null };
  } else {
    next = { status: "failed", error_code: "RESOLVED_FAILED", error_message: (opts.note ?? "Marked failed by an admin after checking the chain").slice(0, 500) };
  }
  const { data } = await db.from("transactions").update(next as never).eq("id", id).eq("status", t.status).select("*").maybeSingle();
  if (!data) throw new EngineError(409, "NOT_RESOLVABLE", "transaction changed while resolving; reload and try again");
  await audit({ app_id: t.app_id, wallet_id: t.wallet_id, action: `tx_resolved:${action}`, details: { transaction_id: id, admin, tx_hash: opts.txHash ?? null } });
  if (action === "mark_failed") await queueWebhook(data as unknown as TxRow);
  return txDto(data as unknown as TxRow);
}

/** Emails ALERT_EMAIL (comma separated) at most once per 30 minutes per kind. Never throws. */
export async function alertAdmins(kind: string, subject: string, text: string) {
  try {
    if (!process.env["ALERT_EMAIL"]) return;
    await rateLimit(`alert:${kind}`, 1, 30 * 60_000);
    const { sendAlertEmail } = await import("./email.server");
    await sendAlertEmail(subject, text);
  } catch { /* rate limited or email not configured: the dashboard still shows it */ }
}

// ---------------- webhooks ----------------
async function queueWebhook(t: TxRow) {
  const { data: app } = await db.from("registered_apps").select("webhook_url").eq("id", t.app_id).maybeSingle();
  if (!app?.webhook_url) return;
  const event = t.status === "confirmed" ? "transaction.confirmed" : "transaction.failed";
  const { data: dup } = await db.from("webhook_deliveries").select("id").eq("transaction_id", t.id).eq("event", event).limit(1).maybeSingle();
  if (dup) return;
  await db.from("webhook_deliveries").insert({ app_id: t.app_id, transaction_id: t.id, event, payload: { event, transaction: txDto(t) } as never });
}

async function hmacHex(secret: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deliverWebhooks(limit = 20) {
  const { data: rows } = await db.from("webhook_deliveries").select("*").eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit);
  let n = 0;
  for (const d of rows ?? []) {
    // Claim the delivery first (push its next attempt two minutes out) so parallel workers don't send it twice.
    const { data: claimed } = await db.from("webhook_deliveries").update({ next_attempt_at: new Date(Date.now() + 2 * 60_000).toISOString() }).eq("id", d.id).eq("status", "pending").eq("next_attempt_at", d.next_attempt_at).select("id");
    if (!claimed?.length) continue;
    const { data: app } = await db.from("registered_apps").select("webhook_url,webhook_secret").eq("id", d.app_id).maybeSingle();
    if (!app?.webhook_url || !app.webhook_secret) { await db.from("webhook_deliveries").update({ status: "skipped" }).eq("id", d.id); continue; }
    const body = JSON.stringify(d.payload);
    let ok = false; let err = "";
    try {
      const res = await fetch(app.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": `sha256=${await hmacHex(app.webhook_secret, body)}`, "X-Event-Id": d.id },
        body,
        signal: AbortSignal.timeout(8000),
      });
      ok = res.ok; if (!ok) err = `HTTP ${res.status}`;
    } catch (e) { err = String((e as Error).message).slice(0, 200); }
    const attempts = d.attempts + 1;
    const expired = Date.now() - new Date(d.created_at).getTime() > WEBHOOK_MAX_AGE_MS;
    await db.from("webhook_deliveries").update({
      attempts, status: ok ? "delivered" : expired ? "failed" : "pending", last_error: ok ? null : err,
      next_attempt_at: new Date(Date.now() + webhookBackoffMs(attempts)).toISOString(),
    }).eq("id", d.id);
    n++;
  }
  return n;
}
