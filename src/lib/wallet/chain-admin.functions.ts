import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: unknown, userId: string) {
  const { data } = await (supabase as { rpc: (n: string, a: object) => Promise<{ data: boolean }> }).rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const chainDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId?: string | null; status?: string | null; hideTest?: boolean }) =>
    z.object({ appId: z.string().uuid().nullish(), status: z.string().max(20).nullish(), hideTest: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    let txq = sb.from("transactions").select("id,app_id,type,status,tx_hash,error_code,error_message,created_at,confirmed_at,network,signer_key").order("created_at", { ascending: false }).limit(100);
    if (data.appId) txq = txq.eq("app_id", data.appId);
    if (data.status) txq = txq.eq("status", data.status);
    let tokq = sb.from("tokens").select("id,app_id,name,symbol,address,swappable,is_test,created_at,imported_from,creator_ref,sync_enabled,synced_block,synced_at,sync_error,holder_count,event_count,total_supply").order("created_at", { ascending: false }).limit(200);
    let colq = sb.from("collections").select("id,app_id,name,symbol,address,royalty_bps,frozen,is_test,created_at").order("created_at", { ascending: false }).limit(200);
    if (data.hideTest) { tokq = tokq.eq("is_test", false); colq = colq.eq("is_test", false); }
    if (data.appId) { tokq = tokq.eq("app_id", data.appId); colq = colq.eq("app_id", data.appId); }
    const day = new Date(Date.now() - 864e5).toISOString();
    const [txs, tokens, cols, nfts, wallets, queued, opQueued, confirmed24, failed24, apps, hooks] = await Promise.all([
      txq, tokq, colq,
      sb.from("nfts").select("id", { count: "exact", head: true }),
      sb.from("wallets").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("id", { count: "exact", head: true }).in("status", ["queued", "processing", "submitted", "finalizing"]),
      sb.from("transactions").select("id", { count: "exact", head: true }).like("signer_key", "operator:%").in("status", ["queued", "processing", "submitted", "finalizing"]),
      sb.from("transactions").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("created_at", day),
      sb.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", day),
      sb.from("registered_apps").select("id,name,webhook_url,daily_mint_cap,daily_distribute_cap,rate_limit_per_min,mainnet_enabled,api_enabled").is("revoked_at", null).order("name"),
      sb.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const [ldAll, ldLegacy, ldLast] = await Promise.all([
      sb.from("wallets").select("id", { count: "exact", head: true }).in("imported_from", ["loop-do", "loop-do-legacy"]),
      sb.from("wallets").select("id", { count: "exact", head: true }).eq("imported_from", "loop-do-legacy"),
      sb.from("wallets").select("created_at").in("imported_from", ["loop-do", "loop-do-legacy"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const opDepth = opQueued.count ?? 0;
    return {
      stats: {
        wallets: wallets.count ?? 0, tokens: tokens.data?.length ?? 0, collections: cols.data?.length ?? 0, nfts: nfts.count ?? 0,
        inFlight: queued.count ?? 0, operatorQueue: opDepth, operatorWaitSeconds: opDepth * 14,
        confirmed24h: confirmed24.count ?? 0, failed24h: failed24.count ?? 0, pendingWebhooks: hooks.count ?? 0,
        loopDoImported: ldAll.count ?? 0, loopDoLegacy: ldLegacy.count ?? 0, loopDoLastAt: ldLast.data?.created_at ?? null,
      },
      transactions: txs.data ?? [], tokens: tokens.data ?? [], collections: cols.data ?? [], apps: apps.data ?? [],
      relayConfigured: !!process.env["RELAY_API_KEY"],
    };
  });

export const adminUpdateAppChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; webhook_url?: string | null; daily_mint_cap?: number | null; daily_distribute_cap?: number | null; rate_limit_per_min?: number; rotateWebhookSecret?: boolean; rotateApiKey?: boolean }) =>
    z.object({
      id: z.string().uuid(),
      webhook_url: z.string().url().max(500).startsWith("https://").nullish(),
      daily_mint_cap: z.number().nonnegative().nullish(),
      daily_distribute_cap: z.number().nonnegative().nullish(),
      rate_limit_per_min: z.number().int().min(1).max(10000).optional(),
      rotateWebhookSecret: z.boolean().optional(),
      rotateApiKey: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomToken, sha256Hex } = await import("./crypto");
    const patch: Record<string, unknown> = {};
    for (const k of ["webhook_url", "daily_mint_cap", "daily_distribute_cap", "rate_limit_per_min"] as const) if (data[k] !== undefined) patch[k] = data[k];
    let webhookSecret: string | null = null;
    let apiKey: string | null = null;
    if (data.rotateWebhookSecret) { webhookSecret = randomToken("whsec_", 24); patch["webhook_secret"] = webhookSecret; }
    if (data.rotateApiKey) { apiKey = randomToken("lwk_", 24); patch["key_hash"] = await sha256Hex(apiKey); patch["key_prefix"] = apiKey.slice(0, 10); }
    await supabaseAdmin.from("registered_apps").update(patch as never).eq("id", data.id);
    const svc = await import("./service.server");
    await svc.audit({ app_id: data.id, action: "app_settings_changed", details: { admin: context.userId, fields: Object.keys(patch).filter((k) => k !== "webhook_secret" && k !== "key_hash") } });
    return { ok: true, webhookSecret, apiKey };
  });

export const adminMarkTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "token" | "collection"; id: string; isTest: boolean }) =>
    z.object({ kind: z.enum(["token", "collection"]), id: z.string().uuid(), isTest: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from(data.kind === "token" ? "tokens" : "collections").update({ is_test: data.isTest }).eq("id", data.id);
    return { ok: true };
  });

const importInput = z.object({
  appId: z.string().uuid(),
  mode: z.enum(["new-wallets", "tokens", "creation-dates"]),
  csv: z.string().max(2_000_000),
  dryRun: z.boolean(),
});

function parseCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(0, 5000).map((l) => {
    const cells = l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""])) as Record<string, string>;
  });
}

export const adminImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof importInput>) => importInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const mig = await import("./migrate.server");
    const rows = parseCsv(data.csv);
    if (data.mode === "tokens") {
      const res = await mig.importTokens({ appId: data.appId, dryRun: data.dryRun, rows: rows.filter((r) => r["address"]).map((r) => ({ address: r["address"]!, name: r["name"] || r["symbol"] || "Token", symbol: r["symbol"] || "TKN", swappable: r["swappable"] === "true" })) });
      return { rows: res.map((r) => ({ externalId: r.address, status: r.status })) };
    }
    if (data.mode === "creation-dates") {
      const res = await mig.setCreationDates({
        appId: data.appId, dryRun: data.dryRun, actor: context.userId,
        rows: rows.map((r) => ({ externalId: r["user_id"] || r["external_id"] || "", createdAt: r["created_at"] || r["createdat"] || "" })).filter((r) => r.externalId && r.createdAt),
      });
      return { rows: res };
    }
    const res = await mig.importWallets({
      appId: data.appId, dryRun: data.dryRun, actor: context.userId,
      rows: rows.map((r) => ({ externalId: r["external_id"] || r["externalid"] || r["email"] || "", email: r["email"], kind: r["kind"] || undefined })).filter((r) => r.externalId),
    });
    return { rows: res };
  });

export const adminTokenHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tokenId: string }) => z.object({ tokenId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const [holders, events] = await Promise.all([
      sb.from("token_holders").select("address,balance").eq("token_id", data.tokenId).order("balance", { ascending: false }).limit(200),
      sb.from("chain_events").select("tx_hash,block_number,from_address,to_address,amount").eq("token_id", data.tokenId).order("block_number", { ascending: false }).limit(200),
    ]);
    const addrs = [...new Set([...(holders.data ?? []).map((h) => h.address), ...(events.data ?? []).flatMap((e) => [e.from_address, e.to_address])])];
    const { data: ws } = addrs.length ? await sb.from("wallets").select("address,email,external_id").in("address", addrs.slice(0, 500)) : { data: [] };
    const who: Record<string, string> = {};
    for (const w of ws ?? []) who[w.address] = w.email ?? (w.external_id ? `user ${w.external_id}` : "");
    return {
      holders: (holders.data ?? []).map((h) => ({ ...h, balance: String(h.balance), who: who[h.address] ?? null })),
      events: (events.data ?? []).map((e) => ({ ...e, amount: String(e.amount), fromWho: who[e.from_address] ?? null, toWho: who[e.to_address] ?? null })),
    };
  });

export const adminResyncToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tokenId: string }) => z.object({ tokenId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("tokens").update({ sync_enabled: true, synced_block: null, sync_target_block: null, sync_continuation: null, sync_error: null }).eq("id", data.tokenId);
    const { syncTokens } = await import("./token-sync.server");
    return syncTokens(20_000);
  });

export const adminLinkImportedWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; address: string; confirm?: boolean }) =>
    z.object({ email: z.string().email().max(254), address: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/), confirm: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    const want = BigInt(data.address);
    const { data: cands } = await db.from("wallets").select("id,address,external_id,user_id,imported_from").like("imported_from", "loop-do%").ilike("address", `%${want.toString(16).slice(-12)}`);
    const imp = (cands ?? []).find((w) => BigInt(w.address) === want);
    if (!imp) return { ok: false as const, error: "No moved-in Loop Do wallet has that address." };
    if (imp.user_id) return { ok: false as const, error: "That wallet is already linked to an account." };
    const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users.find((u) => u.email?.toLowerCase() === email);
    if (!user) return { ok: false as const, error: "No hub account uses that email." };
    if (!data.confirm) return { ok: true as const, preview: true, loopDoUserId: imp.external_id, address: imp.address };
    try {
      const { claimImportedWallet } = await import("./service.server");
      const w = await claimImportedWallet(user.id, email, imp.id, "admin_link", context.userId);
      return { ok: true as const, preview: false, loopDoUserId: imp.external_id, address: w.address };
    } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  });

// ---------- operations: stuck transactions, encryption key ----------
export const adminResolveTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: "attach_hash" | "mark_failed" | "requeue"; txHash?: string; note?: string }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["attach_hash", "mark_failed", "requeue"]), txHash: z.string().max(80).optional(), note: z.string().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { resolveTransaction } = await import("./engine.server");
    try {
      const tx = await resolveTransaction(data.id, data.action, { ...(data.txHash ? { txHash: data.txHash } : {}), ...(data.note ? { note: data.note } : {}) }, context.userId);
      return { ok: true as const, status: tx.status };
    } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  });

export const adminKeyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { keyStatus } = await import("./key-rotation.server");
    try { return { ok: true as const, ...(await keyStatus()) }; } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  });

export const adminRotateKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dryRun: boolean }) => z.object({ dryRun: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { rotateWalletKeys } = await import("./key-rotation.server");
    try { return { ok: true as const, ...(await rotateWalletKeys(200, data.dryRun, context.userId)) }; } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  });

// ---------- log of newly created wallets ----------
export const adminNewWallets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId?: string | null }) => z.object({ appId: z.string().uuid().nullish() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const day = new Date(Date.now() - 864e5).toISOString();
    const week = new Date(Date.now() - 7 * 864e5).toISOString();
    let q = sb.from("wallets").select("id,email,address,app_id,external_id,kind,deployed,email_verified_at,imported_from,user_id,created_at,network").is("retired_at", null).order("created_at", { ascending: false }).limit(300);
    if (data.appId) q = q.eq("app_id", data.appId);
    const [rows, apps, total, last24, last7] = await Promise.all([
      q,
      sb.from("registered_apps").select("id,name"),
      sb.from("wallets").select("id", { count: "exact", head: true }).is("retired_at", null),
      sb.from("wallets").select("id", { count: "exact", head: true }).is("retired_at", null).gte("created_at", day),
      sb.from("wallets").select("id", { count: "exact", head: true }).is("retired_at", null).gte("created_at", week),
    ]);
    const name = new Map((apps.data ?? []).map((a) => [a.id, a.name]));
    return {
      counts: { total: total.count ?? 0, last24h: last24.count ?? 0, last7d: last7.count ?? 0 },
      wallets: (rows.data ?? []).map((w) => ({
        id: w.id, createdAt: w.created_at, email: w.email, address: w.address, externalId: w.external_id, kind: w.kind, network: w.network,
        deployed: w.deployed, emailVerified: !!w.email_verified_at,
        app: w.app_id ? (name.get(w.app_id) ?? "app") : null,
        source: w.imported_from ? "Imported" : w.user_id ? "Wallet portal" : "App sign-up",
      })),
    };
  });

export const adminEstimateWalletDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dryRun: boolean }) => z.object({ dryRun: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const mig = await import("./migrate.server");
    try { return await mig.estimateWalletDates({ dryRun: data.dryRun, actor: context.userId }); }
    catch (e) { return { ok: false as const, error: (e as Error).message }; }
  });

// ---------- everything that needs attention ----------
export const adminIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const [unknownQ, failedQ, queuedQ, submittedQ, hooksQ, hooksFailedQ, otpQ, legacyQ, errQ, tokQ, appsQ] = await Promise.all([
      sb.from("transactions").select("id,app_id,type,status,tx_hash,error_code,error_message,created_at,wallet_id,signer_key").eq("error_code", "SUBMISSION_UNKNOWN").in("status", ["processing", "submitted", "finalizing"]).limit(50),
      sb.from("transactions").select("id,app_id,type,status,tx_hash,error_code,error_message,created_at,wallet_id,signer_key").eq("status", "failed").gte("created_at", ago(7 * 864e5)).order("created_at", { ascending: false }).limit(100),
      sb.from("transactions").select("id,app_id,type,status,created_at,signer_key").eq("status", "queued").lt("created_at", ago(10 * 60_000)).order("created_at").limit(50),
      sb.from("transactions").select("id,app_id,type,status,tx_hash,created_at,submitted_at,signer_key").eq("status", "submitted").is("error_code", null).lt("submitted_at", ago(5 * 60_000)).order("submitted_at").limit(50),
      sb.from("webhook_deliveries").select("id,app_id,event,attempts,status,last_error,created_at,transaction_id").eq("status", "pending").gte("attempts", 3).order("created_at").limit(50),
      sb.from("webhook_deliveries").select("id,app_id,event,attempts,status,last_error,created_at,transaction_id").eq("status", "failed").gte("created_at", ago(7 * 864e5)).order("created_at", { ascending: false }).limit(50),
      sb.from("audit_logs").select("wallet_id,created_at").eq("action", "otp_failed").gte("created_at", ago(864e5)).limit(1000),
      sb.from("audit_logs").select("app_id,method,created_at").eq("action", "legacy_endpoint_called").gte("created_at", ago(7 * 864e5)).limit(1000),
      sb.from("audit_logs").select("app_id,method,details,created_at").eq("action", "api_error").gte("created_at", ago(864e5)).order("created_at", { ascending: false }).limit(40),
      sb.from("tokens").select("id,name,symbol,address,sync_error,synced_at").not("sync_error", "is", null).limit(50),
      sb.from("registered_apps").select("id,name"),
    ]);
    const appName = new Map((appsQ.data ?? []).map((a) => [a.id, a.name]));
    const an = (id: string | null) => (id ? (appName.get(id) ?? "app") : "–");

    // Wallets behind failed transactions, and wallets with lots of wrong codes.
    const otpCount = new Map<string, number>();
    for (const r of otpQ.data ?? []) if (r.wallet_id) otpCount.set(r.wallet_id, (otpCount.get(r.wallet_id) ?? 0) + 1);
    const suspicious = [...otpCount].filter(([, n]) => n >= 5);
    const walletIds = [...new Set([...(failedQ.data ?? []).map((t) => t.wallet_id).filter((x): x is string => !!x), ...suspicious.map(([id]) => id)])].slice(0, 200);
    const { data: ws } = walletIds.length ? await sb.from("wallets").select("id,email,external_id,address,app_id").in("id", walletIds) : { data: [] as { id: string; email: string | null; external_id: string | null; address: string; app_id: string | null }[] };
    const who = new Map((ws ?? []).map((w) => [w.id, w.email ?? (w.external_id ? `user ${w.external_id}` : w.address)]));

    const tx = (t: { id: string; app_id: string; type: string; status: string; created_at: string; tx_hash?: string | null; error_code?: string | null; error_message?: string | null; wallet_id?: string | null; signer_key?: string }) => ({
      id: t.id, app: an(t.app_id), type: t.type, status: t.status, txHash: t.tx_hash ?? null, errorCode: t.error_code ?? null, errorMessage: t.error_message ?? null,
      createdAt: t.created_at, who: t.wallet_id ? (who.get(t.wallet_id) ?? null) : null, lane: t.signer_key ?? null,
    });
    const failed = (failedQ.data ?? []).map(tx);
    const byCode: Record<string, number> = {};
    for (const f of failed) byCode[f.errorCode ?? "UNKNOWN"] = (byCode[f.errorCode ?? "UNKNOWN"] ?? 0) + 1;

    const legacy = new Map<string, { app: string; endpoint: string; n: number; last: string }>();
    for (const r of legacyQ.data ?? []) {
      const k = `${r.app_id}|${r.method}`; const cur = legacy.get(k);
      legacy.set(k, { app: an(r.app_id), endpoint: r.method ?? "", n: (cur?.n ?? 0) + 1, last: !cur || r.created_at > cur.last ? r.created_at : cur.last });
    }

    const day = Date.now() - 864e5;
    const result = {
      unknown: (unknownQ.data ?? []).map(tx),
      stuckQueued: (queuedQ.data ?? []).map(tx),
      stuckSubmitted: (submittedQ.data ?? []).map(tx),
      failed, failedByCode: byCode,
      failedLast24h: failed.filter((f) => Date.parse(f.createdAt) > day).length,
      webhooks: [...(hooksQ.data ?? []), ...(hooksFailedQ.data ?? [])].map((h) => ({ id: h.id, app: an(h.app_id), event: h.event, attempts: h.attempts, status: h.status, lastError: h.last_error, createdAt: h.created_at })),
      apiErrors: (errQ.data ?? []).map((e) => ({ app: an(e.app_id), endpoint: e.method ?? "", message: String(((e.details ?? {}) as Record<string, unknown>)["message"] ?? ""), code: String(((e.details ?? {}) as Record<string, unknown>)["code"] ?? ""), createdAt: e.created_at })),
      wrongCodes: suspicious.map(([id, n]) => ({ who: who.get(id) ?? id, attempts: n })).sort((a, b) => b.attempts - a.attempts),
      legacyCalls: [...legacy.values()].sort((a, b) => b.n - a.n),
      tokenSyncErrors: (tokQ.data ?? []).map((t) => ({ name: t.name, symbol: t.symbol, address: t.address, error: t.sync_error ?? "", at: t.synced_at })),
    };
    const issueCount = result.unknown.length + result.stuckQueued.length + result.stuckSubmitted.length + result.failedLast24h + result.webhooks.length + result.apiErrors.length + result.wrongCodes.length + result.tokenSyncErrors.length + result.legacyCalls.length;
    return { ...result, issueCount, asOf: new Date().toISOString() };
  });
