// Server-only wallet service. Import dynamically from inside handlers.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateWallet, signTypedMessage, STRK_TOKEN } from "./starknet";
import { decryptSecret, encryptSecret, randomOtp, randomToken, sha256B64Url, sha256Hex } from "./crypto";
import {
  AUTH_CODE_TTL_MS,
  OTP_TTL_MS,
  SESSION_TTL_MS,
  checkOtpUsable,
  isOriginAllowed,
  isSessionActive,
  resendWaitSeconds,
} from "./rules";

const db = supabaseAdmin;
type App = {
  id: string;
  name: string;
  allowed_origins: string[];
  popup_enabled: boolean;
  api_enabled: boolean;
  trusted_oauth: boolean;
  sandbox: boolean;
  revoked_at: string | null;
};

function encKey() {
  const k = process.env["WALLET_ENCRYPTION_KEY"];
  if (!k) throw new Error("WALLET_ENCRYPTION_KEY missing");
  return k;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: Record<string, unknown>) {
    super(message ?? code);
  }
}

export async function audit(e: {
  wallet_id?: string | null;
  app_id?: string | null;
  action: string;
  method?: string;
  ip?: string | null;
  details?: Record<string, unknown>;
}) {
  await db.from("audit_logs").insert({
    wallet_id: e.wallet_id ?? null,
    app_id: e.app_id ?? null,
    action: e.action,
    method: e.method ?? null,
    ip: e.ip ?? null,
    details: (e.details ?? {}) as never,
  });
}

export async function rateLimit(key: string, max: number, windowMs: number) {
  const { data } = await db.from("rate_limits").select("*").eq("key", key).maybeSingle();
  const now = Date.now();
  if (!data || now - new Date(data.window_start).getTime() > windowMs) {
    await db.from("rate_limits").upsert({ key, count: 1, window_start: new Date().toISOString() });
    return;
  }
  if (data.count >= max) throw new ApiError(429, "rate_limited", "Too many requests, slow down.");
  await db.from("rate_limits").update({ count: data.count + 1 }).eq("key", key);
}

// ---------- apps ----------
export async function appFromKey(rawKey: string | null): Promise<App> {
  if (!rawKey) throw new ApiError(401, "missing_app_key");
  const { data } = await db.from("registered_apps").select("*").eq("key_hash", await sha256Hex(rawKey)).maybeSingle();
  if (!data || data.revoked_at) throw new ApiError(401, "invalid_app_key");
  return data as App;
}

export async function appById(id: string): Promise<App> {
  const { data } = await db.from("registered_apps").select("*").eq("id", id).maybeSingle();
  if (!data || data.revoked_at) throw new ApiError(404, "unknown_app");
  return data as App;
}

export async function createApp(input: { name: string; allowed_origins: string[]; sandbox?: boolean | undefined; trusted_oauth?: boolean | undefined }) {
  const raw = randomToken("lwk_", 24);
  const { data, error } = await db
    .from("registered_apps")
    .insert({
      name: input.name,
      allowed_origins: input.allowed_origins,
      sandbox: !!input.sandbox,
      trusted_oauth: !!input.trusted_oauth,
      key_prefix: raw.slice(0, 10),
      key_hash: await sha256Hex(raw),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, app_key: raw };
}

// ---------- wallets ----------
async function insertWallet(email: string, opts: { user_id?: string; verified?: boolean; method?: string; app_id?: string | null }) {
  const w = generateWallet();
  const { data, error } = await db
    .from("wallets")
    .insert({
      email,
      user_id: opts.user_id ?? null,
      address: w.address,
      public_key: w.publicKey,
      class_hash: w.classHash,
      encrypted_private_key: await encryptSecret(w.privateKey, encKey()),
      verified: !!opts.verified,
      verified_method: opts.method ?? null,
      created_by_app: opts.app_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function issueSession(walletId: string, appId: string | null, ip?: string | null, ua?: string | null) {
  const token = randomToken("lws_");
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.from("wallet_sessions").insert({
    wallet_id: walletId,
    app_id: appId,
    token_hash: await sha256Hex(token),
    ip: ip ?? null,
    user_agent: ua?.slice(0, 300) ?? null,
    expires_at: expires,
  });
  return { session_token: token, expires_at: expires };
}

export async function revokeAllSessions(walletId: string) {
  await db.from("wallet_sessions").update({ revoked_at: new Date().toISOString() }).eq("wallet_id", walletId).is("revoked_at", null);
}

async function sendOtp(wallet: { id: string; email: string }, app: App, ip: string | null) {
  const code = randomOtp();
  await db.from("wallet_verifications").update({ consumed_at: new Date().toISOString() }).eq("wallet_id", wallet.id).is("consumed_at", null);
  await db.from("wallet_verifications").insert({
    wallet_id: wallet.id,
    app_id: app.id,
    code_hash: await sha256Hex(wallet.id + ":" + code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  // Email delivery is wired once an email sender domain is configured.
  console.log(`[otp] code issued for wallet ${wallet.id}`);
  await audit({ wallet_id: wallet.id, app_id: app.id, action: "otp_sent", ip });
  return app.sandbox ? { debug_code: code } : {};
}

export async function getOrCreate(app: App, input: { email: string; oauth_verified?: boolean | undefined }, ip: string | null, ua: string | null) {
  if (!app.api_enabled) throw new ApiError(403, "api_disabled");
  const email = input.email.trim().toLowerCase();
  await rateLimit(`goc:${app.id}:${ip}`, 30, 60_000);
  const { data: existing } = await db.from("wallets").select("*").eq("email", email).maybeSingle();

  if (!existing) {
    const w = await insertWallet(email, { app_id: app.id });
    await audit({ wallet_id: w.id, app_id: app.id, action: "wallet_created", ip });
    const s = await issueSession(w.id, app.id, ip, ua);
    return { status: "created", address: w.address, verified: false, ...s };
  }

  if (input.oauth_verified && app.trusted_oauth) {
    return takeover(existing.id, app.id, "oauth", ip, ua);
  }

  const extra = await sendOtp(existing, app, ip);
  return { status: "requires_verification", address: existing.address, ...extra };
}

export async function takeover(walletId: string, appId: string | null, method: string, ip: string | null, ua: string | null) {
  await revokeAllSessions(walletId);
  const { data: w } = await db
    .from("wallets")
    .update({ verified: true, verified_method: method, updated_at: new Date().toISOString() })
    .eq("id", walletId)
    .select("*")
    .single();
  await audit({ wallet_id: walletId, app_id: appId, action: "reclaimed_by_owner", method, ip, details: { at: new Date().toISOString() } });
  const s = await issueSession(walletId, appId, ip, ua);
  return { status: "verified", address: w!.address, verified: true, ...s };
}

async function walletByEmail(email: string) {
  const { data } = await db.from("wallets").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (!data) throw new ApiError(404, "wallet_not_found");
  return data;
}

export async function verifyOtp(app: App, email: string, code: string, ip: string | null, ua: string | null) {
  const w = await walletByEmail(email);
  const { data: v } = await db
    .from("wallet_verifications")
    .select("*")
    .eq("wallet_id", w.id)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!v) throw new ApiError(400, "no_pending_code");
  const state = checkOtpUsable(v);
  if (state !== "ok") throw new ApiError(400, state);
  if ((await sha256Hex(w.id + ":" + code)) !== v.code_hash) {
    await db.from("wallet_verifications").update({ attempts: v.attempts + 1 }).eq("id", v.id);
    await audit({ wallet_id: w.id, app_id: app.id, action: "otp_failed", ip });
    throw new ApiError(400, "invalid_code", "Incorrect code", { attempts_left: Math.max(0, 4 - v.attempts) });
  }
  await db.from("wallet_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", v.id);
  return takeover(w.id, app.id, "email_otp", ip, ua);
}

export async function resendOtp(app: App, email: string, ip: string | null) {
  const w = await walletByEmail(email);
  const { data: v } = await db
    .from("wallet_verifications")
    .select("last_sent_at")
    .eq("wallet_id", w.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (v) {
    const wait = resendWaitSeconds(v);
    if (wait > 0) throw new ApiError(429, "resend_cooldown", `Wait ${wait}s`, { retry_after: wait });
  }
  const extra = await sendOtp(w, app, ip);
  return { status: "sent", ...extra };
}

export async function walletFromSession(token: string | null) {
  if (!token) throw new ApiError(401, "missing_session");
  const { data: s } = await db.from("wallet_sessions").select("*").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!s || !isSessionActive(s)) throw new ApiError(401, "invalid_session");
  const { data: w } = await db.from("wallets").select("*").eq("id", s.wallet_id).single();
  return { wallet: w!, session: s };
}

export async function signWithWallet(walletId: string, appId: string | null, typed: unknown, ip: string | null) {
  const { data: w } = await db.from("wallets").select("*").eq("id", walletId).single();
  const pk = await decryptSecret(w!.encrypted_private_key, encKey());
  const result = signTypedMessage(pk, w!.address, typed as never);
  await audit({ wallet_id: walletId, app_id: appId, action: "signed_typed_data", ip, details: { message_hash: result.message_hash } });
  return { address: w!.address, ...result };
}

export async function getAssets(address: string) {
  const { data: w } = await db.from("wallets").select("id,address,verified,deployed").eq("address", address.toLowerCase()).maybeSingle();
  if (!w) throw new ApiError(404, "wallet_not_found");
  const { data: items } = await db.from("app_assets").select("kind,name,amount,metadata,created_at").eq("wallet_id", w.id);
  let strk = "0";
  try {
    const rpc = process.env["STARKNET_RPC_URL"] ?? "https://api.cartridge.gg/x/starknet/sepolia";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: {
          request: {
            contract_address: STRK_TOKEN,
            entry_point_selector: "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
            calldata: [w.address],
          },
          block_id: "latest",
        },
      }),
    });
    const j = (await res.json()) as { result?: string[] };
    if (j.result?.[0]) strk = (BigInt(j.result[0]) + (BigInt(j.result[1] ?? 0) << 128n)).toString();
  } catch (e) {
    console.error("rpc balance failed", e);
  }
  return {
    address: w.address,
    network: "starknet-sepolia",
    deployed: w.deployed,
    verified: w.verified,
    balances: [{ token: "STRK", contract: STRK_TOKEN, raw: strk, decimals: 18 }],
    items: items ?? [],
  };
}

// ---------- portal (signed-in owner) ----------
export async function ensureOwnerWallet(userId: string, email: string, method: string, ip: string | null) {
  const { data: linked } = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  if (linked) return linked;
  const { data: byEmail } = await db.from("wallets").select("*").eq("email", email.toLowerCase()).maybeSingle();
  if (byEmail) {
    await revokeAllSessions(byEmail.id);
    const { data } = await db
      .from("wallets")
      .update({ user_id: userId, verified: true, verified_method: method, updated_at: new Date().toISOString() })
      .eq("id", byEmail.id)
      .select("*")
      .single();
    await audit({ wallet_id: byEmail.id, action: "reclaimed_by_owner", method, ip });
    return data!;
  }
  const w = await insertWallet(email.toLowerCase(), { user_id: userId, verified: true, method });
  await audit({ wallet_id: w.id, action: "wallet_created", method, ip });
  return w;
}

// ---------- popup (code + PKCE) ----------
export async function createAuthCode(walletId: string, app: App, origin: string, challenge: string) {
  if (!app.popup_enabled) throw new ApiError(403, "popup_disabled");
  if (!isOriginAllowed(origin, app.allowed_origins)) throw new ApiError(403, "origin_not_allowed");
  await db.from("app_connections").upsert({ wallet_id: walletId, app_id: app.id, revoked_at: null }, { onConflict: "wallet_id,app_id" });
  const code = randomToken("lwc_", 24);
  await db.from("auth_codes").insert({
    code_hash: await sha256Hex(code),
    wallet_id: walletId,
    app_id: app.id,
    code_challenge: challenge,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  await audit({ wallet_id: walletId, app_id: app.id, action: "app_connected", details: { origin } });
  return code;
}

export async function exchangeCode(code: string, verifier: string, ip: string | null, ua: string | null) {
  const { data: c } = await db.from("auth_codes").select("*").eq("code_hash", await sha256Hex(code)).maybeSingle();
  if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now()) throw new ApiError(400, "invalid_code");
  if (!c.code_challenge || (await sha256B64Url(verifier)) !== c.code_challenge) throw new ApiError(400, "invalid_verifier");
  await db.from("auth_codes").update({ used_at: new Date().toISOString() }).eq("id", c.id);
  const { data: w } = await db.from("wallets").select("address,verified,email").eq("id", c.wallet_id).single();
  const s = await issueSession(c.wallet_id, c.app_id, ip, ua);
  return { address: w!.address, verified: w!.verified, email: w!.email, ...s };
}

export async function requireConnection(walletId: string, app: App, origin: string) {
  if (!isOriginAllowed(origin, app.allowed_origins)) throw new ApiError(403, "origin_not_allowed");
  const { data } = await db.from("app_connections").select("revoked_at").eq("wallet_id", walletId).eq("app_id", app.id).maybeSingle();
  if (!data || data.revoked_at) throw new ApiError(403, "not_connected");
}
