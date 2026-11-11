// Central wallet API v1 (brief section 8). Bearer app key, Idempotency-Key on writes, JSON errors
// `{ error: { code, message, details } }`. Each app only sees its own wallets/tokens/collections.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appFromKey, audit, rateLimit, ApiError } from "./service.server";
import { EngineError, enqueue, getTx, tick, txDto, waitForTx, type TxRow } from "./engine.server";
import { sealKey } from "./crypto";
import { emailVerifiedEffective, isOperatorKey, laneKey, laneOf, normalizeEmail, pickLane, queueFull, retryAfterForQueue } from "./rules";
import { generateWallet } from "./starknet";
import { canRemoveMinter, capExceeded, fromBaseUnits, kindAllowed, sameAddress, signerKeyOperator, signerKeyWallet, swapPairAllowed, toBaseUnits } from "./chain-rules";

const db = supabaseAdmin;
type App = Awaited<ReturnType<typeof appFromKey>> & { mainnet_enabled?: boolean; daily_mint_cap?: number | null; daily_distribute_cap?: number | null; rate_limit_per_min?: number };

const uuid = z.string().uuid();
const addr = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, "invalid Starknet address");
const amount = z.string().regex(/^\d+(\.\d{1,18})?$/, 'amount must be a decimal string like "12.5"');
const str = (max: number) => z.string().trim().min(1).max(max);
const attributes = z.array(z.object({ key: str(64), value: z.union([z.string().max(256), z.number(), z.boolean()]) })).max(128);
const media = z.array(z.object({ role: z.string().max(32).optional(), uri: str(512), mimeType: z.string().max(64).optional(), contentHash: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).optional() })).max(32);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type,idempotency-key,x-app-key",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...cors, "Access-Control-Expose-Headers": "retry-after", ...extra } });
const err = (status: number, code: string, message?: string, details?: Record<string, unknown>) => {
  const ra = Number(details?.["retry_after"]);
  return json({ error: { code, message: message ?? code, details: details ?? {} } }, status, ra > 0 ? { "Retry-After": String(Math.ceil(ra)) } : {});
};

/** Run `fn` over `items` with at most `limit` in flight, so one request can't flood the RPC node. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}
const balanceCache = new Map<string, { at: number; value: unknown }>();
const num = (name: string, dflt: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : dflt; };

export function preflightV1() {
  return new Response(null, { status: 204, headers: cors });
}

type Ctx = { app: App; req: Request; url: URL; body: Record<string, unknown>; network: string; idem: string | null; ip: string | null };

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new EngineError(400, "VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

async function walletOf(ctx: Ctx, id: string) {
  if (!uuid.safeParse(id).success) throw new EngineError(404, "NOT_FOUND", "wallet not found");
  const { data } = await db.from("wallets").select("id,app_id,external_id,kind,label,address,deployed,network,created_at,email").eq("id", id).maybeSingle();
  if (!data) throw new EngineError(404, "NOT_FOUND", "wallet not found");
  if (data.app_id !== ctx.app.id) {
    const { data: link } = await db.from("wallet_app_links").select("wallet_id").eq("app_id", ctx.app.id).eq("wallet_id", data.id).limit(1).maybeSingle();
    if (!link) throw new EngineError(404, "NOT_FOUND", "wallet not found");
  }
  return data;
}
async function tokenOf(ctx: Ctx, id: string) {
  if (!uuid.safeParse(id).success) throw new EngineError(404, "NOT_FOUND", "token not found");
  const { data } = await db.from("tokens").select("*").eq("id", id).maybeSingle();
  if (!data || data.app_id !== ctx.app.id) throw new EngineError(404, "NOT_FOUND", "token not found");
  if (!data.address) throw new EngineError(409, "NOT_READY", "token is still being created");
  return data;
}
async function collectionOf(ctx: Ctx, id: string) {
  if (!uuid.safeParse(id).success) throw new EngineError(404, "NOT_FOUND", "collection not found");
  const { data } = await db.from("collections").select("*").eq("id", id).maybeSingle();
  if (!data || data.app_id !== ctx.app.id) throw new EngineError(404, "NOT_FOUND", "collection not found");
  if (!data.address) throw new EngineError(409, "NOT_READY", "collection is still being created");
  return data;
}
/** Destination may be any address; a walletId must belong to this app. */
async function destination(ctx: Ctx, b: { toWalletId?: string | undefined; toAddress?: string | undefined }) {
  if (b.toWalletId) { const w = await walletOf(ctx, b.toWalletId); return { to: w.address, toWalletId: w.id }; }
  if (b.toAddress) {
    const { data } = await db.from("wallets").select("id").eq("address", "0x" + BigInt(b.toAddress).toString(16).padStart(64, "0")).maybeSingle();
    return { to: b.toAddress, toWalletId: data?.id ?? "" };
  }
  throw new EngineError(400, "VALIDATION", "toWalletId or toAddress is required");
}
const dest = { toWalletId: uuid.optional(), toAddress: addr.optional() };

async function capCheck(ctx: Ctx, types: string[], requestRaw: bigint, cap: number | null | undefined) {
  if (cap === null || cap === undefined) return;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await db.from("transactions").select("request").eq("app_id", ctx.app.id).in("type", types).neq("status", "failed").gte("created_at", since).limit(2000);
  const used = (data ?? []).reduce((s, r) => s + BigInt(((r.request as Record<string, Record<string, string>>)["_r"]?.["amountRaw"]) ?? "0"), 0n);
  if (capExceeded(used, requestRaw, cap)) throw new EngineError(429, "CAP_EXCEEDED", "daily cap for this app reached", { cap: String(cap), used: fromBaseUnits(used) });
}

/** Number of parallel operator signers. Sponsored (outside-execution) transactions don't use the operator's on-chain nonce, so they can run side by side. */
const operatorLanes = () => Math.min(32, Math.round(num("OPERATOR_LANES", 6)));

/** Least-loaded operator lane for this network. */
async function chooseLane(network: string) {
  const lanes = operatorLanes();
  const { data } = await db.from("transactions").select("signer_key").like("signer_key", `operator:${network}%`).in("status", ["queued", "processing", "submitted", "finalizing"]).limit(2000);
  const load = new Array<number>(lanes).fill(0);
  for (const r of data ?? []) { const l = laneOf(r.signer_key, network); if (l !== null && l < lanes) load[l]!++; }
  return laneKey(network, pickLane(load));
}

/** Refuse new work (429 + Retry-After) when one app already has too much waiting, or one wallet is spamming sponsored transactions. */
async function admit(ctx: Ctx, walletId: string | null) {
  const { count } = await db.from("transactions").select("id", { count: "exact", head: true }).eq("app_id", ctx.app.id).in("status", ["queued", "processing", "submitted", "finalizing"]);
  const cap = num("MAX_QUEUED_PER_APP", 300);
  if (queueFull(count ?? 0, cap)) {
    throw new EngineError(429, "QUEUE_FULL", "this app already has too many transactions waiting; retry shortly", { queued: count ?? 0, cap, retry_after: retryAfterForQueue(count ?? 0, operatorLanes()) });
  }
  if (walletId) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: day } = await db.from("transactions").select("id", { count: "exact", head: true }).eq("wallet_id", walletId).gte("created_at", since);
    const walletCap = num("MAX_TX_PER_WALLET_PER_DAY", 500);
    if ((day ?? 0) >= walletCap) throw new EngineError(429, "WALLET_DAILY_LIMIT", "this wallet reached its daily transaction limit", { cap: walletCap, retry_after: 3600 });
  }
}

async function queue(ctx: Ctx, type: string, signerKey: string, walletId: string | null, request: Record<string, unknown>, resolved: Record<string, unknown>) {
  if (!ctx.idem) throw new EngineError(400, "VALIDATION", "Idempotency-Key header is required");
  let queued: Awaited<ReturnType<typeof enqueue>>;
  try {
    // Limits only apply to brand-new requests: replaying an Idempotency-Key never gets refused.
    queued = await enqueue({
      appId: ctx.app.id, network: ctx.network, type, idempotencyKey: ctx.idem, walletId, request, resolved,
      signerKey: async () => { await admit(ctx, walletId); return isOperatorKey(signerKey) ? chooseLane(ctx.network) : signerKey; },
    });
  } catch (e) {
    const k = e as { status?: number; code?: string; message?: string };
    if (k.code === "IDEMPOTENCY_CONFLICT") return err(409, k.code, k.message);
    throw e;
  }
  const { tx, replay } = queued;
  let final: TxRow | null = tx;
  if (!replay) await tick({ maxClaims: operatorLanes() + 4, budgetMs: 10_000 }).catch((e) => console.error("tick", e));
  if (ctx.url.searchParams.get("wait") === "true") final = await waitForTx(tx.id);
  else final = await getTx(tx.id);
  return json(txDto(final ?? tx), replay ? 200 : 202);
}

function walletDto(w: { id: string; external_id: string | null; kind: string; label: string | null; address: string; deployed: boolean; network: string; created_at: string }) {
  return { id: w.id, externalId: w.external_id, kind: w.kind, label: w.label, address: w.address, network: w.network, deployed: w.deployed, createdAt: w.created_at };
}

// ------------------------------------------------------------------ handlers
async function linkToApp(ctx: Ctx, externalId: string, walletId: string, how: string) {
  // This is only reached after the email was proven (emailed code, or Google via a trusted app).
  const { evictUnverifiedControllers } = await import("./service.server");
  await evictUnverifiedControllers(walletId, { appId: ctx.app.id, network: ctx.network, externalId }, ctx.ip, how);
  await db.from("wallet_app_links").upsert({ app_id: ctx.app.id, network: ctx.network, external_id: externalId, wallet_id: walletId });
  await audit({ app_id: ctx.app.id, wallet_id: walletId, action: "wallet_linked_by_email", ip: ctx.ip, details: { external_id: externalId, how } });
  const { data: w } = await db.from("wallets").select("*").eq("id", walletId).single();
  return { ...walletDto(w!), externalId, reused: true };
}

async function verifyWalletLink(ctx: Ctx) {
  const b = parse(z.object({ verificationId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }), ctx.body);
  const { checkEmailProof } = await import("./service.server");
  try {
    const v = await checkEmailProof({ id: b.verificationId, purpose: "app_link", appId: ctx.app.id }, b.code, ctx.ip);
    return json(await linkToApp({ ...ctx, network: v.network ?? ctx.network }, v.external_id!, v.wallet_id, "email_code"), 200);
  } catch (e) {
    const ae = e as { status?: number; code?: string; message: string; extra?: Record<string, unknown> };
    return json({ error: { code: ae.code === "invalid_code" ? "INVALID_CODE" : (ae.code ?? "VALIDATION").toUpperCase(), message: ae.message, ...(ae.extra ?? {}) } }, ae.status ?? 400);
  }
}

/** A live wallet on this network that carries the email (current or retired). Plain equality filters only. */
async function walletByEmail(network: string, email: string) {
  for (const col of ["email", "retired_email"] as const) {
    const { data } = await db.from("wallets").select("*").eq("network", network).is("retired_at", null).eq(col, email).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function createWallet(ctx: Ctx) {
  const b = parse(z.object({ externalId: str(200), kind: z.enum(["user", "collection_owner", "treasury"]).default("user"), label: z.string().max(200).optional(), email: z.string().email().max(254).optional(), emailVerified: z.boolean().optional(), signInMethod: z.enum(["google", "password", "other"]).optional() }), ctx.body);
  const { data: linkRow } = await db.from("wallet_app_links").select("wallet_id").eq("app_id", ctx.app.id).eq("network", ctx.network).eq("external_id", b.externalId).maybeSingle();
  if (linkRow) { const { data: lw } = await db.from("wallets").select("*").eq("id", linkRow.wallet_id).single(); return json({ ...walletDto(lw!), externalId: b.externalId, reused: true }, 200); }
  const { data: existing } = await db.from("wallets").select("*").eq("app_id", ctx.app.id).eq("network", ctx.network).eq("external_id", b.externalId).maybeSingle();
  if (existing) return json(walletDto(existing), 200);
  const trusted = !!(ctx.app as { trusted_oauth?: boolean }).trusted_oauth;
  // Same email = same wallet across apps, but only after proof: an emailed code, unless the user came via Google and the admin trusts this app for Google.
  if (b.email && b.kind === "user") {
    const em = normalizeEmail(b.email);
    const same = await walletByEmail(ctx.network, em);
    if (same) {
      const { needsEmailProof } = await import("./rules");
      const method = b.signInMethod ?? "other";
      if (needsEmailProof({ walletExists: true, alreadyLinked: false, method, appTrustedGoogle: trusted })) {
        const { startEmailProof } = await import("./service.server");
        try {
          const verificationId = await startEmailProof(same.id, { purpose: "app_link", appId: ctx.app.id, externalId: b.externalId, network: ctx.network }, ctx.ip);
          return json({ status: "verification_required", verificationId, message: "A 6-digit code was emailed. Send it to POST /v1/wallets/verify." }, 202);
        } catch (e) {
          const ae = e as { status?: number; code?: string; message: string; extra?: Record<string, unknown> };
          return err(ae.status ?? 400, ae.code === "resend_cooldown" || ae.code === "rate_limited" ? "RATE_LIMITED" : "VALIDATION", ae.message, ae.extra);
        }
      }
      return json(await linkToApp(ctx, b.externalId, same.id, "google"), 200);
    }
  }
  const key = process.env["WALLET_ENCRYPTION_KEY"];
  if (!key) throw new EngineError(503, "CONFIG_ERROR", "wallet key not configured");
  const w = generateWallet();
  let email: string | null = b.email ? normalizeEmail(b.email) : null;
  if (email) { const { data: taken } = await db.from("wallets").select("id").eq("email", email).eq("network", ctx.network).maybeSingle(); if (taken) email = null; }
  // The email is stored so one person can later be matched to one wallet, but it only counts as verified when this
  // app is trusted to say so. Otherwise whoever proves the email later takes the wallet over (see linkToApp).
  const proven = !!email && emailVerifiedEffective(b.emailVerified, trusted);
  const sealed = await sealKey(w.privateKey);
  const row = (e: string | null) => ({
    app_id: ctx.app.id, network: ctx.network, external_id: b.externalId, kind: b.kind, label: b.label ?? null, email: e, email_verified_at: e && proven ? new Date().toISOString() : null,
    address: w.address, public_key: w.publicKey, class_hash: w.classHash, encrypted_private_key: sealed, created_by_app: ctx.app.id,
  });
  let { data, error } = await db.from("wallets").insert(row(email)).select("*").single();
  if (error?.code === "23505") {
    const { data: again } = await db.from("wallets").select("*").eq("app_id", ctx.app.id).eq("network", ctx.network).eq("external_id", b.externalId).maybeSingle();
    if (again) return json(walletDto(again), 200);
    if (email) ({ data, error } = await db.from("wallets").insert(row(null)).select("*").single()); // email already used by another row: keep the wallet, drop the email
  }
  if (error || !data) throw error ?? new Error("wallet insert failed");
  await audit({ app_id: ctx.app.id, wallet_id: data.id, action: "wallet_created", ip: ctx.ip, details: { kind: b.kind, email_verified: proven } });
  return json(walletDto(data), 201);
}

async function balances(ctx: Ctx, id: string) {
  const w = await walletOf(ctx, id);
  const core = await import("./core/core");
  const { data: toks } = await db.from("tokens").select("id,symbol,address,decimals").eq("network", w.network).not("address", "is", null).limit(100);
  const r = core.readers(w.network);
  const cacheKey = `bal:${w.network}:${w.address}`;
  const hit = balanceCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5_000) return json(hit.value);
  const out = await mapLimit(toks ?? [], 8, async (t) => {
    try { const raw = await r.tokenBalance(t.address!, w.address); return { tokenId: t.id, symbol: t.symbol, address: t.address, balance: fromBaseUnits(raw, t.decimals), balanceRaw: raw }; }
    catch { return null; }
  });
  const value = { walletId: w.id, address: w.address, tokens: out.filter((x) => x && x.balanceRaw !== "0") };
  balanceCache.set(cacheKey, { at: Date.now(), value });
  if (balanceCache.size > 500) balanceCache.delete(balanceCache.keys().next().value!);
  return json(value);
}

async function walletNfts(ctx: Ctx, id: string) {
  const w = await walletOf(ctx, id);
  const core = await import("./core/core");
  const { data } = await db.from("nfts").select("collection_id,token_id,token_uri,attributes,media,frozen,collections(address)").eq("owner_wallet_id", w.id).limit(100);
  const r = core.readers(w.network);
  const verified = await mapLimit(data ?? [], 8, async (n) => {
    const col = (n.collections as unknown as { address: string } | null)?.address;
    try { if (col && !sameAddress(await r.nftOwner(col, BigInt(n.token_id)), w.address)) return null; } catch { /* keep DB answer if RPC fails */ }
    return { collectionId: n.collection_id, tokenId: n.token_id, tokenUri: n.token_uri, attributes: n.attributes, media: n.media, frozen: n.frozen };
  });
  return json(verified.filter(Boolean));
}

async function tokenDetail(ctx: Ctx, id: string) {
  const t = await tokenOf(ctx, id);
  const core = await import("./core/core");
  const r = core.readers(t.network);
  const [supply, fb] = await Promise.all([r.tokenSupply(t.address!).catch(() => null), r.factoryBalance(t.address!).catch(() => null)]);
  return json({ id: t.id, name: t.name, symbol: t.symbol, address: t.address, decimals: t.decimals, swappable: t.swappable, totalSupply: supply && fromBaseUnits(supply), factoryBalance: fb && fromBaseUnits(fb) });
}

async function collectionDetail(ctx: Ctx, id: string) {
  const c = await collectionOf(ctx, id);
  const core = await import("./core/core");
  const minted = await core.readers(c.network).totalMinted(c.address!).catch(() => null);
  return json({ id: c.id, name: c.name, symbol: c.symbol, address: c.address, ownerWalletId: c.owner_wallet_id, royaltyReceiver: c.royalty_receiver, royaltyBps: c.royalty_bps, frozen: c.frozen, totalMinted: minted });
}

async function ownerWalletFor(ctx: Ctx, c: { owner_wallet_id: string }) {
  const w = await walletOf(ctx, c.owner_wallet_id);
  if (!kindAllowed(w.kind, "collection_owner")) throw new EngineError(403, "NOT_OWNER", "collection owner wallet must be of kind collection_owner");
  return w;
}

async function nftRow(c: { id: string }, tokenId: string) {
  if (!/^\d{1,40}$/.test(tokenId)) throw new EngineError(404, "NOT_FOUND", "nft not found");
  const { data } = await db.from("nfts").select("*").eq("collection_id", c.id).eq("token_id", tokenId).maybeSingle();
  if (!data) throw new EngineError(404, "NOT_FOUND", "nft not found");
  return data;
}

// ------------------------------------------------------------------ router
export async function dispatchV1(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  const m = request.method.toUpperCase();
  try {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? request.headers.get("x-app-key");
    let app: App;
    try { app = (await appFromKey(bearer)) as App; } catch { return err(401, "UNAUTHORIZED", "missing or invalid app API key"); }
    if (!app.api_enabled) return err(403, "UNAUTHORIZED", "API access is disabled for this app");
    try { await rateLimit(`v1:${app.id}`, app.rate_limit_per_min ?? 60, 60_000, { failOpen: true }); }
    catch (e) { return err(429, "RATE_LIMITED", "too many requests; wait for Retry-After seconds", { retry_after: (e as { extra?: { retry_after?: number } }).extra?.retry_after ?? 5 }); }

    const body = m === "GET" || m === "DELETE" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const network = String(url.searchParams.get("network") ?? body["network"] ?? "sepolia");
    const core = await import("./core/core");
    if (!core.NETWORKS[network as "sepolia"]) return err(400, "NETWORK_DISABLED", `network ${network} is not available yet`);
    if (network === "mainnet" && !app.mainnet_enabled) return err(403, "NETWORK_DISABLED", "mainnet is not enabled for this app");
    delete body["network"];
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ctx: Ctx = { app, req: request, url, body, network, idem: request.headers.get("idempotency-key"), ip };
    if (["POST", "PATCH", "DELETE"].includes(m) && !ctx.idem && path !== "wallets" && path !== "wallets/verify") return err(400, "VALIDATION", "Idempotency-Key header is required");
    await audit({ app_id: app.id, action: "api_call", method: `${m} /v1/${path}`.slice(0, 120), ip });

    const seg = path.split("/").filter(Boolean);
    const [a, id, b, sub, c] = seg;
    const op = signerKeyOperator(network);

    // wallets
    if (a === "wallets" && !id && m === "POST") return await createWallet(ctx);
    if (a === "wallets" && id === "verify" && !b && m === "POST") return await verifyWalletLink(ctx);
    if (a === "wallets" && !id && m === "GET") {
      const ext = url.searchParams.get("externalId");
      let q = db.from("wallets").select("*").eq("app_id", app.id).eq("network", network).order("created_at", { ascending: false }).limit(100);
      if (ext) q = q.eq("external_id", ext);
      const { data } = await q;
      return json((data ?? []).map(walletDto));
    }
    if (a === "wallets" && id && !b && m === "GET") return json(walletDto(await walletOf(ctx, id)));
    if (a === "wallets" && id && b === "balances" && m === "GET") return await balances(ctx, id);
    if (a === "wallets" && id && b === "nfts" && m === "GET") return await walletNfts(ctx, id);

    // tokens
    if (a === "tokens" && !id && m === "POST") {
      const v = parse(z.object({ name: str(64), symbol: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9]+$/), initialSupply: amount, swappable: z.boolean().optional() }), body);
      const raw = toBaseUnits(v.initialSupply);
      await capCheck(ctx, ["token.create", "token.mint"], raw, app.daily_mint_cap);
      return await queue(ctx, "token.create", op, null, v, { name: v.name, symbol: v.symbol.toUpperCase(), amountRaw: raw.toString(), swappable: String(!!v.swappable) });
    }
    if (a === "tokens" && !id && m === "GET") {
      const { data } = await db.from("tokens").select("id,name,symbol,address,decimals,swappable,created_at").eq("app_id", app.id).eq("network", network).order("created_at", { ascending: false });
      return json(data ?? []);
    }
    if (a === "tokens" && id && !b && m === "GET") return await tokenDetail(ctx, id);
    if (a === "tokens" && id && b === "mint" && m === "POST") {
      const t = await tokenOf(ctx, id);
      const v = parse(z.object({ amount }), body);
      const raw = toBaseUnits(v.amount);
      await capCheck(ctx, ["token.create", "token.mint"], raw, app.daily_mint_cap);
      return await queue(ctx, "token.mint", op, null, { tokenId: id, ...v }, { token: t.address, amountRaw: raw.toString() });
    }
    if (a === "tokens" && id && b === "distribute" && m === "POST") {
      const t = await tokenOf(ctx, id);
      const v = parse(z.object({ amount, ...dest }), body);
      const raw = toBaseUnits(v.amount);
      await capCheck(ctx, ["token.distribute"], raw, app.daily_distribute_cap);
      const d = await destination(ctx, v);
      return await queue(ctx, "token.distribute", op, null, { tokenId: id, ...v }, { token: t.address, amountRaw: raw.toString(), ...d });
    }

    // token movement (holder signs)
    if (a === "transfers" && m === "POST") {
      const v = parse(z.object({ fromWalletId: uuid, tokenId: uuid, amount, ...dest }), body);
      const [w, t] = [await walletOf(ctx, v.fromWalletId), await tokenOf(ctx, v.tokenId)];
      if (!kindAllowed(w.kind, "movement")) throw new EngineError(403, "VALIDATION", "this wallet kind cannot move tokens");
      const d = await destination(ctx, v);
      return await queue(ctx, "transfer", signerKeyWallet(w.id), w.id, v, { token: t.address, amountRaw: toBaseUnits(v.amount).toString(), ...d });
    }
    if (a === "returns" && m === "POST") {
      const v = parse(z.object({ walletId: uuid, tokenId: uuid, amount }), body);
      const [w, t] = [await walletOf(ctx, v.walletId), await tokenOf(ctx, v.tokenId)];
      if (!kindAllowed(w.kind, "movement")) throw new EngineError(403, "VALIDATION", "this wallet kind cannot move tokens");
      return await queue(ctx, "return", signerKeyWallet(w.id), w.id, v, { token: t.address, amountRaw: toBaseUnits(v.amount).toString() });
    }
    if (a === "swaps" && m === "POST") {
      const v = parse(z.object({ walletId: uuid, fromTokenId: uuid, toTokenId: uuid, amount }), body);
      if (v.fromTokenId === v.toTokenId) throw new EngineError(400, "VALIDATION", "cannot swap a token to itself");
      const [w, f, t] = [await walletOf(ctx, v.walletId), await tokenOf(ctx, v.fromTokenId), await tokenOf(ctx, v.toTokenId)];
      if (!swapPairAllowed(app.name, f.swappable, t.swappable)) throw new EngineError(403, "SWAP_NOT_ALLOWED", "both tokens must be marked swappable");
      if (!kindAllowed(w.kind, "movement")) throw new EngineError(403, "VALIDATION", "this wallet kind cannot move tokens");
      return await queue(ctx, "swap", signerKeyWallet(w.id), w.id, v, { fromToken: f.address, toToken: t.address, amountRaw: toBaseUnits(v.amount).toString() });
    }

    // collections
    if (a === "collections" && !id && m === "POST") {
      const v = parse(z.object({ name: str(64), symbol: z.string().trim().min(1).max(16), ownerWalletId: uuid, royaltyReceiver: addr.optional(), royaltyBps: z.number().int().min(0).max(10000).optional() }), body);
      const w = await walletOf(ctx, v.ownerWalletId);
      if (!kindAllowed(w.kind, "collection_owner")) throw new EngineError(400, "VALIDATION", "ownerWalletId must be a wallet of kind collection_owner");
      return await queue(ctx, "collection.create", op, null, v, { name: v.name, symbol: v.symbol, creator: w.address, ownerWalletId: w.id, royaltyReceiver: v.royaltyReceiver ?? w.address, royaltyBps: String(v.royaltyBps ?? 0) });
    }
    if (a === "collections" && !id && m === "GET") {
      const { data } = await db.from("collections").select("id,name,symbol,address,owner_wallet_id,royalty_receiver,royalty_bps,frozen,created_at").eq("app_id", app.id).eq("network", network).order("created_at", { ascending: false });
      return json(data ?? []);
    }
    if (a === "collections" && id && !b && m === "GET") return await collectionDetail(ctx, id);
    if (a === "collections" && id && b === "royalties" && m === "PATCH") {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col);
      const v = parse(z.object({ receiver: addr, bps: z.number().int().min(0).max(10000) }), body);
      return await queue(ctx, "collection.royalty", signerKeyWallet(w.id), w.id, { collectionId: id, ...v }, { collection: col.address, collectionId: id, receiver: v.receiver, bps: String(v.bps) });
    }
    if (a === "collections" && id && b === "freeze" && m === "POST") {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col);
      if (body["confirm"] !== true) throw new EngineError(400, "VALIDATION", 'freezing is permanent: send { "confirm": true }');
      if (col.frozen) throw new EngineError(409, "METADATA_FROZEN", "collection is already frozen");
      return await queue(ctx, "collection.freeze", signerKeyWallet(w.id), w.id, { collectionId: id, confirm: true }, { collection: col.address, collectionId: id });
    }
    if (a === "collections" && id && b === "minters" && m === "POST" && !sub) {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col);
      const v = parse(z.object({ address: addr }), body);
      return await queue(ctx, "collection.minter.add", signerKeyWallet(w.id), w.id, { collectionId: id, ...v }, { collection: col.address, collectionId: id, minter: v.address });
    }
    if (a === "collections" && id && b === "minters" && sub && m === "DELETE") {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col);
      parse(addr, sub);
      if (!canRemoveMinter(sub, process.env[`OPERATOR_ADDRESS_${network.toUpperCase()}`])) throw new EngineError(403, "OPERATOR_REQUIRED", "the operator can never be removed as a minter");
      return await queue(ctx, "collection.minter.remove", signerKeyWallet(w.id), w.id, { collectionId: id, address: sub }, { collection: col.address, collectionId: id, minter: sub });
    }

    // nfts
    if (a === "collections" && id && b === "nfts" && !sub && m === "POST") {
      const col = await collectionOf(ctx, id);
      const v = parse(z.object({ tokenUri: str(512), attributes: attributes.optional(), media: media.optional(), ...dest }), body);
      if (col.frozen) throw new EngineError(409, "METADATA_FROZEN", "collection metadata is frozen");
      const d = await destination(ctx, v);
      return await queue(ctx, "nft.mint", op, null, { collectionId: id, ...v }, { collection: col.address, collectionId: id, tokenUri: v.tokenUri, ...d });
    }
    if (a === "collections" && id && b === "nfts" && sub && !c && m === "GET") {
      const col = await collectionOf(ctx, id); const n = await nftRow(col, sub);
      const r = core.readers(col.network);
      const [owner, frozen] = await Promise.all([r.nftOwner(col.address!, BigInt(sub)).catch(() => n.owner_address), r.nftFrozen(col.address!, BigInt(sub)).catch(() => n.frozen)]);
      return json({ collectionId: id, tokenId: sub, owner, tokenUri: n.token_uri, attributes: n.attributes, media: n.media, frozen, royalty: { receiver: col.royalty_receiver, bps: col.royalty_bps } });
    }
    if (a === "collections" && id && b === "nfts" && sub && !c && m === "PATCH") {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col); const n = await nftRow(col, sub);
      const v = parse(z.object({ tokenUri: str(512).optional(), attributes: attributes.optional(), media: media.optional() }), body);
      if (n.frozen || col.frozen) throw new EngineError(409, "METADATA_FROZEN", "this NFT's metadata is frozen");
      return await queue(ctx, "nft.update", signerKeyWallet(w.id), w.id, { collectionId: id, tokenId: sub, ...v }, { collection: col.address, collectionId: id, tokenId: sub });
    }
    if (a === "collections" && id && b === "nfts" && sub && c === "freeze" && m === "POST") {
      const col = await collectionOf(ctx, id); const w = await ownerWalletFor(ctx, col); const n = await nftRow(col, sub);
      if (body["confirm"] !== true) throw new EngineError(400, "VALIDATION", 'freezing is permanent: send { "confirm": true }');
      if (n.frozen) throw new EngineError(409, "METADATA_FROZEN", "already frozen");
      return await queue(ctx, "nft.freeze", signerKeyWallet(w.id), w.id, { collectionId: id, tokenId: sub, confirm: true }, { collection: col.address, collectionId: id, tokenId: sub });
    }
    if (a === "nft-transfers" && m === "POST") {
      const v = parse(z.object({ collectionId: uuid, tokenId: z.string().regex(/^\d{1,40}$/), fromWalletId: uuid, ...dest }), body);
      const col = await collectionOf(ctx, v.collectionId); const w = await walletOf(ctx, v.fromWalletId);
      if (!kindAllowed(w.kind, "movement")) throw new EngineError(403, "VALIDATION", "this wallet kind cannot move NFTs");
      const d = await destination(ctx, v);
      return await queue(ctx, "nft.transfer", signerKeyWallet(w.id), w.id, v, { collection: col.address, collectionId: col.id, tokenId: v.tokenId, ...d });
    }

    // transactions
    if (a === "transactions" && id && !b && m === "GET") {
      const t = uuid.safeParse(id).success ? await getTx(id) : null;
      if (!t || t.app_id !== app.id) throw new EngineError(404, "NOT_FOUND", "transaction not found");
      return json(txDto(t));
    }
    if (a === "transactions" && !id && m === "GET") {
      let q = db.from("transactions").select("*").eq("app_id", app.id).order("created_at", { ascending: false }).limit(Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200));
      const s = url.searchParams.get("status"); if (s) q = q.eq("status", s);
      const ty = url.searchParams.get("type"); if (ty) q = q.eq("type", ty);
      const wid = url.searchParams.get("walletId"); if (wid && uuid.safeParse(wid).success) q = q.eq("wallet_id", wid);
      const { data } = await q;
      return json(((data ?? []) as unknown as TxRow[]).map(txDto));
    }
    if (a === "transactions" && id && b === "cancel" && m === "POST") {
      const t = uuid.safeParse(id).success ? await getTx(id) : null;
      if (!t || t.app_id !== app.id) throw new EngineError(404, "NOT_FOUND", "transaction not found");
      const { data } = await db.from("transactions").update({ status: "cancelled" }).eq("id", id).eq("status", "queued").select("*").maybeSingle();
      if (!data) throw new EngineError(409, "NOT_CANCELLABLE", "only queued transactions can be cancelled");
      return json(txDto(data as unknown as TxRow));
    }

    return err(404, "NOT_FOUND", `no endpoint ${m} /v1/${path}`);
  } catch (e) {
    // Duck-typed: module instances can differ under dev reloads, so instanceof is unreliable.
    const k = e as { status?: unknown; code?: unknown; message?: string; details?: Record<string, unknown> };
    if (typeof k.status === "number" && typeof k.code === "string") {
      return err(k.status, e instanceof ApiError ? k.code.toUpperCase() : k.code, k.message, k.details);
    }
    if (e instanceof Error && /amount must be|decimal places/.test(e.message)) return err(400, "VALIDATION", e.message);
    console.error("v1 error", e);
    return err(500, "SERVER_ERROR", "unexpected error");
  }
}

