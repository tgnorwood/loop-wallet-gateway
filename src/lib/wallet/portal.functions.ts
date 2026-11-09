import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function ip() {
  const r = getRequest();
  return r?.headers.get("cf-connecting-ip") ?? r?.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
}

async function ownerWallet(claims: Record<string, unknown>, userId: string) {
  const email = String(claims["email"] ?? "");
  if (!email) throw new Error("Your account has no email");
  const meta = (claims["app_metadata"] ?? {}) as { provider?: string };
  const svc = await import("./service.server");
  return { svc, wallet: await svc.ensureOwnerWallet(userId, email, meta.provider === "google" ? "google" : "password", ip()) };
}

async function assertAdmin(supabase: { rpc: (...a: never[]) => unknown }, userId: string) {
  const { data } = (await (supabase.rpc as (n: string, a: object) => Promise<{ data: boolean }>)("has_role", {
    _user_id: userId,
    _role: "admin",
  })) as { data: boolean };
  if (!data) throw new Error("Forbidden");
}

export const getPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { svc, wallet } = await ownerWallet(context.claims as never, context.userId);
    const sb = context.supabase;
    const [assets, sessions, activity, conns, isAdmin] = await Promise.all([
      svc.getAssets(wallet.address),
      sb.from("wallet_sessions").select("id,ip,user_agent,created_at,expires_at,app_id,registered_apps(name)").eq("wallet_id", wallet.id).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      sb.from("audit_logs").select("id,action,method,ip,created_at").eq("wallet_id", wallet.id).order("created_at", { ascending: false }).limit(20),
      sb.from("app_connections").select("id,created_at,app_id,registered_apps(name)").eq("wallet_id", wallet.id).is("revoked_at", null),
      sb.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    ]);
    return {
      wallet: { address: wallet.address, email: wallet.email, verified: wallet.verified, deployed: wallet.deployed, class_hash: wallet.class_hash },
      assets,
      sessions: sessions.data ?? [],
      activity: activity.data ?? [],
      connections: conns.data ?? [],
      isAdmin: !!isAdmin.data,
    };
  });

export const signOutEverywhere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { svc, wallet } = await ownerWallet(context.claims as never, context.userId);
    await svc.revokeAllSessions(wallet.id);
    await svc.audit({ wallet_id: wallet.id, action: "sessions_revoked_by_owner", ip: ip() });
    return { ok: true };
  });

export const disconnectApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { connectionId: string }) => z.object({ connectionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { wallet } = await ownerWallet(context.claims as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("app_connections").update({ revoked_at: new Date().toISOString() }).eq("id", data.connectionId).eq("wallet_id", wallet.id).select("app_id").single();
    if (c) await supabaseAdmin.from("wallet_sessions").update({ revoked_at: new Date().toISOString() }).eq("wallet_id", wallet.id).eq("app_id", c.app_id);
    return { ok: true };
  });

// ---------- popup ----------
export const getAppPublic = createServerFn({ method: "POST" })
  .inputValidator((d: { appId: string }) => z.object({ appId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const svc = await import("./service.server");
    const a = await svc.appById(data.appId).catch(() => null);
    return a ? { id: a.id, name: a.name, popup_enabled: a.popup_enabled } : null;
  });

export const approveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId: string; origin: string; challenge: string }) =>
    z.object({ appId: z.string().uuid(), origin: z.string().url().max(300), challenge: z.string().min(43).max(128) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { svc, wallet } = await ownerWallet(context.claims as never, context.userId);
    const app = await svc.appById(data.appId);
    const code = await svc.createAuthCode(wallet.id, app, data.origin, data.challenge);
    return { code, address: wallet.address };
  });

export const approveSign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId: string; origin: string; typedData: unknown }) =>
    z.object({ appId: z.string().uuid(), origin: z.string().url().max(300), typedData: z.any() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { svc, wallet } = await ownerWallet(context.claims as never, context.userId);
    const app = await svc.appById(data.appId);
    await svc.requireConnection(wallet.id, app, data.origin);
    return svc.signWithWallet(wallet.id, app.id, data.typedData, ip());
  });

// ---------- admin ----------
export const adminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const sb = context.supabase;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [total, verified, takeovers, signs, apps] = await Promise.all([
      sb.from("wallets").select("id", { count: "exact", head: true }),
      sb.from("wallets").select("id", { count: "exact", head: true }).eq("verified", true),
      sb.from("audit_logs").select("id,created_at,method,ip,wallet_id,wallets(email,address)").eq("action", "reclaimed_by_owner").order("created_at", { ascending: false }).limit(10),
      sb.from("audit_logs").select("id", { count: "exact", head: true }).eq("action", "signed_typed_data").gte("created_at", since),
      sb.from("registered_apps").select("id,name,key_prefix,allowed_origins,popup_enabled,api_enabled,trusted_oauth,sandbox,revoked_at,created_at").order("created_at", { ascending: false }),
    ]);
    return {
      totalWallets: total.count ?? 0,
      verifiedWallets: verified.count ?? 0,
      signsLast7d: signs.count ?? 0,
      takeovers: takeovers.data ?? [],
      apps: apps.data ?? [],
    };
  });

const appInput = z.object({
  name: z.string().trim().min(1).max(80),
  allowed_origins: z.array(z.string().url().max(300)).max(20),
  trusted_oauth: z.boolean().optional(),
  sandbox: z.boolean().optional(),
});

export const adminCreateApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof appInput>) => appInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const svc = await import("./service.server");
    return svc.createApp({ ...data, allowed_origins: data.allowed_origins.map((o) => new URL(o).origin) });
  });

export const adminUpdateApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; popup_enabled?: boolean; api_enabled?: boolean; trusted_oauth?: boolean; revoke?: boolean; allowed_origins?: string[] }) =>
    z
      .object({
        id: z.string().uuid(),
        popup_enabled: z.boolean().optional(),
        api_enabled: z.boolean().optional(),
        trusted_oauth: z.boolean().optional(),
        revoke: z.boolean().optional(),
        allowed_origins: z.array(z.string().url()).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, revoke, allowed_origins, ...rest } = data;
    await supabaseAdmin
      .from("registered_apps")
      .update({
        ...rest,
        ...(allowed_origins ? { allowed_origins: allowed_origins.map((o) => new URL(o).origin) } : {}),
        ...(revoke ? { revoked_at: new Date().toISOString() } : {}),
      })
      .eq("id", id);
    return { ok: true };
  });

export const adminSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => z.object({ q: z.string().trim().min(3).max(254) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const sb = context.supabase;
    const q = data.q.toLowerCase();
    const { data: w } = await sb.from("wallets").select("id,email,address,verified,verified_method,deployed,class_hash,created_at").or(q.startsWith("0x") ? `address.eq.${q}` : `email.eq.${q}`).maybeSingle();
    if (!w) return null;
    const [logs, sessions] = await Promise.all([
      sb.from("audit_logs").select("id,action,method,ip,created_at,details,registered_apps(name)").eq("wallet_id", w.id).order("created_at", { ascending: false }).limit(100),
      sb.from("wallet_sessions").select("id", { count: "exact", head: true }).eq("wallet_id", w.id).is("revoked_at", null),
    ]);
    return { wallet: w, logs: logs.data ?? [], activeSessions: sessions.count ?? 0 };
  });

export const adminRevokeSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { walletId: string }) => z.object({ walletId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const svc = await import("./service.server");
    await svc.revokeAllSessions(data.walletId);
    await svc.audit({ wallet_id: data.walletId, action: "sessions_revoked_by_admin", details: { admin: context.userId } });
    return { ok: true };
  });

// ---------- sandbox (signed-in developers) ----------
export const sandboxCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { action: "get-or-create" | "verify-otp" | "resend-otp" | "sign"; email?: string; code?: string; token?: string }) =>
    z
      .object({
        action: z.enum(["get-or-create", "verify-otp", "resend-otp", "sign"]),
        email: z.string().trim().email().max(254).optional(),
        code: z.string().regex(/^\d{6}$/).optional(),
        token: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const svc = await import("./service.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let { data: app } = await supabaseAdmin.from("registered_apps").select("*").eq("sandbox", true).is("revoked_at", null).limit(1).maybeSingle();
    if (!app) {
      const created = await svc.createApp({ name: "Developer Sandbox", allowed_origins: [], sandbox: true });
      app = (await supabaseAdmin.from("registered_apps").select("*").eq("id", created.id).single()).data!;
    }
    await svc.rateLimit(`sandbox:${context.userId}`, 40, 60_000);
    try {
      if (data.action === "get-or-create") return await svc.getOrCreate(app as never, { email: data.email! }, ip(), "sandbox");
      if (data.action === "verify-otp") return await svc.verifyOtp(app as never, data.email!, data.code!, ip(), "sandbox");
      if (data.action === "resend-otp") return await svc.resendOtp(app as never, data.email!, ip());
      const { wallet } = await svc.walletFromSession(data.token ?? null);
      return await svc.signWithWallet(wallet.id, app.id, demoTypedData(), ip());
    } catch (e) {
      if (e instanceof svc.ApiError) return { error: e.code, message: e.message, ...e.extra };
      throw e;
    }
  });

function demoTypedData() {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Login: [{ name: "action", type: "shortstring" }],
    },
    primaryType: "Login",
    domain: { name: "Loop Fans", version: "1", chainId: "SN_SEPOLIA", revision: "1" },
    message: { action: "sandbox-test" },
  };
}
