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
    let tokq = sb.from("tokens").select("id,app_id,name,symbol,address,swappable,is_test,created_at").order("created_at", { ascending: false }).limit(200);
    let colq = sb.from("collections").select("id,app_id,name,symbol,address,royalty_bps,frozen,is_test,created_at").order("created_at", { ascending: false }).limit(200);
    if (data.hideTest) { tokq = tokq.eq("is_test", false); colq = colq.eq("is_test", false); }
    if (data.appId) { tokq = tokq.eq("app_id", data.appId); colq = colq.eq("app_id", data.appId); }
    const day = new Date(Date.now() - 864e5).toISOString();
    const [txs, tokens, cols, nfts, wallets, queued, opQueued, confirmed24, failed24, apps, hooks] = await Promise.all([
      txq, tokq, colq,
      sb.from("nfts").select("id", { count: "exact", head: true }),
      sb.from("wallets").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("id", { count: "exact", head: true }).in("status", ["queued", "processing", "submitted"]),
      sb.from("transactions").select("id", { count: "exact", head: true }).like("signer_key", "operator:%").in("status", ["queued", "processing", "submitted"]),
      sb.from("transactions").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("created_at", day),
      sb.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", day),
      sb.from("registered_apps").select("id,name,webhook_url,daily_mint_cap,daily_distribute_cap,rate_limit_per_min,mainnet_enabled,api_enabled").is("revoked_at", null).order("name"),
      sb.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const opDepth = opQueued.count ?? 0;
    return {
      stats: {
        wallets: wallets.count ?? 0, tokens: tokens.data?.length ?? 0, collections: cols.data?.length ?? 0, nfts: nfts.count ?? 0,
        inFlight: queued.count ?? 0, operatorQueue: opDepth, operatorWaitSeconds: opDepth * 14,
        confirmed24h: confirmed24.count ?? 0, failed24h: failed24.count ?? 0, pendingWebhooks: hooks.count ?? 0,
      },
      transactions: txs.data ?? [], tokens: tokens.data ?? [], collections: cols.data ?? [], apps: apps.data ?? [],
      relayConfigured: !!process.env["RELAY_API_KEY"], loopDoSecretConfigured: !!process.env["LOOPDO_WALLET_DERIVATION_SECRET"],
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
  mode: z.enum(["loop-do-wallets", "new-wallets", "tokens"]),
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
    const res = await mig.importWallets({
      appId: data.appId, source: data.mode === "loop-do-wallets" ? "loop-do" : "new", dryRun: data.dryRun, actor: context.userId,
      rows: rows.map((r) => ({ externalId: r["user_id"] || r["external_id"] || r["externalid"] || r["email"] || "", email: r["email"], salt: r["salt"], address: r["address"], kind: r["kind"] || undefined })).filter((r) => r.externalId),
    });
    return { rows: res };
  });
