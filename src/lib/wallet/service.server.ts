// Server-only wallet service. Import dynamically from inside handlers.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateWallet, signTypedMessage, STRK_TOKEN } from "./starknet";
import { openKey, randomOtp, randomToken, sealKey, sha256B64Url, sha256Hex } from "./crypto";
import {
  AUTH_CODE_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SESSION_TTL_MS,
  checkOtpUsable,
  isOriginAllowed,
  isSessionActive,
  resendWaitSeconds,
  canRetireWallet,
  needsEmailProof,
  normalizeEmail,
  shouldEvictControllers,
  isProofMethod,
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

let rateLimitRpc: "unknown" | "yes" | "no" = "unknown";

/**
 * Fixed-window limiter. Counts atomically: through the database function `rate_limit_hit` when it
 * exists, otherwise with compare-and-set updates, so a burst of parallel requests cannot slip past.
 * `failOpen` (for the per-app API limiter) lets a request through if contention exhausts the retries;
 * security limiters (codes, sign-ins) fail closed.
 */
export async function rateLimit(key: string, max: number, windowMs: number, opts: { failOpen?: boolean } = {}) {
  const tooMany = (retryAfter: number) => new ApiError(429, "rate_limited", "Too many requests, slow down.", { retry_after: Math.max(1, retryAfter) });
  if (rateLimitRpc !== "no") {
    const { data, error } = await (db.rpc as unknown as (n: string, a: object) => Promise<{ data: { allowed: boolean; retry_after: number }[] | null; error: { code?: string; message: string } | null }>)("rate_limit_hit", { _key: key, _max: max, _window_ms: windowMs });
    if (!error && data?.[0]) {
      rateLimitRpc = "yes";
      if (!data[0].allowed) throw tooMany(data[0].retry_after);
      return;
    }
    if (error && /could not find|does not exist|PGRST202|42883/i.test(`${error.code ?? ""} ${error.message}`)) rateLimitRpc = "no";
    else if (error) console.error("rate_limit_hit failed", error.message);
  }
  for (let i = 0; i < 6; i++) {
    const { data } = await db.from("rate_limits").select("*").eq("key", key).maybeSingle();
    const now = Date.now();
    if (!data) {
      const { error } = await db.from("rate_limits").insert({ key, count: 1, window_start: new Date().toISOString() });
      if (!error) return;
      continue; // someone created it a moment ago: read again
    }
    if (now - new Date(data.window_start).getTime() > windowMs) {
      const { data: won } = await db.from("rate_limits").update({ count: 1, window_start: new Date().toISOString() }).eq("key", key).eq("window_start", data.window_start).select("key");
      if (won?.length) return;
      continue;
    }
    if (data.count >= max) throw tooMany(Math.ceil((new Date(data.window_start).getTime() + windowMs - now) / 1000));
    const { data: won } = await db.from("rate_limits").update({ count: data.count + 1 }).eq("key", key).eq("count", data.count).select("key");
    if (won?.length) return;
  }
  if (opts.failOpen) return;
  throw tooMany(1);
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

// ---------- one-time codes ----------
type Verification = { id: string; wallet_id: string; app_id: string | null; code_hash: string; attempts: number; expires_at: string; consumed_at: string | null; last_sent_at: string; purpose?: string; user_id?: string | null; external_id?: string | null; network?: string | null };

/**
 * Checks a code with a hard cap of OTP_MAX_ATTEMPTS guesses per code, even when guesses arrive in
 * parallel: each guess first "spends" an attempt with a compare-and-set, and only the request that
 * won that update is allowed to compare the code.
 */
async function spendAttemptAndCheck(v: Verification, code: string, wallet: { id: string }, app_id: string | null, ip: string | null, purpose: string) {
  let cur = v;
  for (let i = 0; i < 8; i++) {
    const state = checkOtpUsable(cur);
    if (state !== "ok") throw new ApiError(400, state);
    const { data: won } = await db.from("wallet_verifications").update({ attempts: cur.attempts + 1 }).eq("id", cur.id).eq("attempts", cur.attempts).is("consumed_at", null).select("*");
    if (won?.length) {
      const attemptsAfter = cur.attempts + 1;
      if ((await sha256Hex(wallet.id + ":" + code.trim())) !== cur.code_hash) {
        await audit({ wallet_id: wallet.id, app_id, action: "otp_failed", ip, details: { purpose } });
        throw new ApiError(400, "invalid_code", "Incorrect code", { attempts_left: Math.max(0, OTP_MAX_ATTEMPTS - attemptsAfter) });
      }
      const { data: used } = await db.from("wallet_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", cur.id).is("consumed_at", null).select("id");
      if (!used?.length) throw new ApiError(400, "consumed");
      return cur;
    }
    const { data: fresh } = await db.from("wallet_verifications").select("*").eq("id", cur.id).maybeSingle();
    if (!fresh) throw new ApiError(400, "no_pending_code");
    cur = fresh as Verification;
  }
  throw new ApiError(429, "rate_limited", "Too many attempts at once, try again.", { retry_after: 2 });
}

/** Cooldown, per-email and per-IP caps for sending a code. */
async function guardCodeSend(email: string, ip: string | null) {
  await rateLimit(`codesend:${normalizeEmail(email)}`, 5, 10 * 60_000);
  if (ip) await rateLimit(`codesend-ip:${ip}`, 20, 10 * 60_000);
}

/**
 * Someone just proved they own this wallet's email. If that email was never proven before, whoever
 * else got hold of the wallet by merely typing the address in (another app's unverified sign-up, an
 * unconfirmed portal account) is removed: their sessions end and their app links are dropped. The wallet
 * itself, and anything in it, stays with the proven owner. Imported Loop Do wallets are left alone.
 */
export async function evictUnverifiedControllers(walletId: string, keep: { appId?: string | null; network?: string | null; externalId?: string | null; userId?: string | null }, ip: string | null, via: string) {
  const { data: w } = await db.from("wallets").select("id,app_id,external_id,user_id,email_verified_at,imported_from").eq("id", walletId).maybeSingle();
  if (!w || !shouldEvictControllers(w)) {
    if (w && !w.email_verified_at) await db.from("wallets").update({ email_verified_at: new Date().toISOString() }).eq("id", walletId);
    return { evicted: false };
  }
  await revokeAllSessions(walletId);
  const { data: links } = await db.from("wallet_app_links").select("app_id,network,external_id").eq("wallet_id", walletId);
  let removed = 0;
  for (const l of links ?? []) {
    if (keep.appId && l.app_id === keep.appId && l.external_id === keep.externalId && (!keep.network || l.network === keep.network)) continue;
    await db.from("wallet_app_links").delete().eq("wallet_id", walletId).eq("app_id", l.app_id).eq("network", l.network).eq("external_id", l.external_id);
    removed++;
  }
  const patch: Record<string, unknown> = { email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const homeIsKeeper = !!keep.appId && w.app_id === keep.appId && w.external_id === keep.externalId;
  if (w.app_id && !homeIsKeeper) { patch["app_id"] = null; patch["external_id"] = null; }
  if (w.user_id && w.user_id !== keep.userId) patch["user_id"] = null;
  await db.from("wallets").update(patch as never).eq("id", walletId);
  await audit({ wallet_id: walletId, app_id: keep.appId ?? null, action: "unverified_controllers_removed", ip, details: { via, links_removed: removed, home_app_cleared: "app_id" in patch, portal_user_cleared: "user_id" in patch } });
  return { evicted: true };
}

// ---------- wallets ----------
async function insertWallet(email: string, opts: { user_id?: string; verified?: boolean; emailProven?: boolean; method?: string; app_id?: string | null }) {
  const w = generateWallet();
  const { data, error } = await db
    .from("wallets")
    .insert({
      email,
      user_id: opts.user_id ?? null,
      address: w.address,
      public_key: w.publicKey,
      class_hash: w.classHash,
      encrypted_private_key: await sealKey(w.privateKey),
      verified: !!opts.verified,
      email_verified_at: opts.emailProven ? new Date().toISOString() : null,
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

async function sendOtp(wallet: { id: string; email: string | null }, app: App, ip: string | null) {
  if (!wallet.email) throw new ApiError(400, "wallet_has_no_email");
  await guardCodeSend(wallet.email, ip);
  const code = randomOtp();
  await db.from("wallet_verifications").update({ consumed_at: new Date().toISOString() }).eq("wallet_id", wallet.id).is("consumed_at", null);
  const { data: ver } = await db.from("wallet_verifications").insert({
    wallet_id: wallet.id,
    app_id: app.id,
    code_hash: await sha256Hex(wallet.id + ":" + code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  }).select("id").single();
  const { sendOtpEmail } = await import("./email.server");
  const sent = await sendOtpEmail(wallet.email, code, `otp-${ver?.id ?? wallet.id}`);
  await audit({ wallet_id: wallet.id, app_id: app.id, action: sent.ok ? "otp_sent" : "otp_send_failed", ip, details: sent.ok ? {} : { error: sent.error } });
  return app.sandbox ? { debug_code: code } : {};
}

/**
 * Legacy email-only sign-in (/wallet/get-or-create). The public routes are retired (410) unless
 * LEGACY_WALLET_API=on; the developer sandbox still uses this. An email that already has a wallet
 * always needs an emailed code: no caller-supplied flag can skip it, and the wallet address is not
 * revealed until the code is proven.
 */
export async function getOrCreate(app: App, input: { email: string }, ip: string | null, ua: string | null) {
  if (!app.api_enabled) throw new ApiError(403, "api_disabled");
  const email = normalizeEmail(input.email);
  await rateLimit(`goc:${app.id}:${ip}`, 30, 60_000);
  const { data: existing } = await db.from("wallets").select("*").eq("email", email).is("retired_at", null).limit(1).maybeSingle();

  if (!existing) {
    const w = await insertWallet(email, { app_id: app.id });
    await audit({ wallet_id: w.id, app_id: app.id, action: "wallet_created", ip });
    const s = await issueSession(w.id, app.id, ip, ua);
    return { status: "created", address: w.address, verified: false, ...s };
  }

  const extra = await sendOtp(existing, app, ip);
  return { status: "requires_verification", ...extra };
}

export async function takeover(walletId: string, appId: string | null, method: string, ip: string | null, ua: string | null) {
  await evictUnverifiedControllers(walletId, { appId: null, userId: null }, ip, method);
  await revokeAllSessions(walletId);
  const { data: w } = await db
    .from("wallets")
    .update({ verified: true, verified_method: method, email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", walletId)
    .select("*")
    .single();
  await audit({ wallet_id: walletId, app_id: appId, action: "reclaimed_by_owner", method, ip, details: { at: new Date().toISOString() } });
  const s = await issueSession(walletId, appId, ip, ua);
  return { status: "verified", address: w!.address, verified: true, ...s };
}

async function walletByEmail(email: string) {
  const { data } = await db.from("wallets").select("*").eq("email", normalizeEmail(email)).is("retired_at", null).limit(1).maybeSingle();
  if (!data) throw new ApiError(404, "wallet_not_found");
  return data;
}

export async function verifyOtp(app: App, email: string, code: string, ip: string | null, ua: string | null) {
  const w = await walletByEmail(email);
  const { data: v } = await db
    .from("wallet_verifications")
    .select("*")
    .eq("wallet_id", w.id)
    .eq("purpose", "takeover")
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!v) throw new ApiError(400, "no_pending_code");
  await spendAttemptAndCheck(v as Verification, code, w, app.id, ip, "takeover");
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
  const pk = await openKey(w!.encrypted_private_key);
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
    const { rpcFetch } = await import("./rpc.server");
    const res = await rpcFetch(
      JSON.stringify({
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
    );
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
export class VerifyRequired extends Error { constructor(public walletId: string) { super("verify_required"); } }

/** Wallet nobody owns yet that carries this email (live or retired). Plain equality filters, never string-built. */
async function findUnownedByEmail(email: string) {
  for (const col of ["email", "retired_email"] as const) {
    const { data } = await db.from("wallets").select("id,imported_from,email_verified_at").is("user_id", null).is("retired_at", null).eq(col, email).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Returns the signed-in owner's wallet. Throws VerifyRequired when the email already has a wallet the
 *  person doesn't own yet and they didn't sign in with Google — they must enter an emailed code first. */
export async function ensureOwnerWallet(userId: string, email: string, method: string, ip: string | null) {
  const lower = normalizeEmail(email);
  const google = method === "google";
  const unowned = await findUnownedByEmail(lower);
  if (unowned && !(unowned.imported_from && !unowned.email_verified_at)) {
    if (needsEmailProof({ walletExists: true, alreadyLinked: false, method: google ? "google" : "password", appTrustedGoogle: false, isHubGoogle: google })) throw new VerifyRequired(unowned.id);
    try { return await claimImportedWallet(userId, lower, unowned.id, method, null, true); }
    catch (e) { await audit({ wallet_id: unowned.id, action: "loop_do_claim_needs_admin", ip, details: { error: (e as Error).message } }); }
  }
  const { data: linked } = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  if (linked) {
    // Signing in with Google proves the email: mark it verified (and drop anyone who only typed it in elsewhere).
    if (google && !linked.email_verified_at && linked.email && normalizeEmail(linked.email) === lower) {
      await evictUnverifiedControllers(linked.id, { userId }, ip, "google");
      return { ...linked, email_verified_at: new Date().toISOString() };
    }
    return linked;
  }
  // Google vouches for the address. A password sign-up is not proof until the person later enters an emailed code.
  const w = await insertWallet(lower, { user_id: userId, verified: true, emailProven: google, method });
  await audit({ wallet_id: w.id, action: "wallet_created", method, ip });
  return w;
}

// ---------- email proof codes (portal claim + partner app linking) ----------
export async function startEmailProof(walletId: string, p: { purpose: "portal_claim" | "app_link"; appId?: string | null; userId?: string | null; externalId?: string | null; network?: string | null }, ip: string | null) {
  const { data: w } = await db.from("wallets").select("id,email,retired_email").eq("id", walletId).single();
  const to = w?.email ?? w?.retired_email;
  if (!to) throw new ApiError(400, "wallet_has_no_email");
  await guardCodeSend(to, ip);
  const { data: last } = await db.from("wallet_verifications").select("last_sent_at").eq("wallet_id", walletId).eq("purpose", p.purpose).is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last) { const wait = resendWaitSeconds(last); if (wait > 0) throw new ApiError(429, "resend_cooldown", `Wait ${wait}s`, { retry_after: wait }); }
  await db.from("wallet_verifications").update({ consumed_at: new Date().toISOString() }).eq("wallet_id", walletId).eq("purpose", p.purpose).is("consumed_at", null);
  const code = randomOtp();
  const { data: ver } = await db.from("wallet_verifications").insert({
    wallet_id: walletId, app_id: p.appId ?? null, purpose: p.purpose, user_id: p.userId ?? null, external_id: p.externalId ?? null, network: p.network ?? null,
    code_hash: await sha256Hex(walletId + ":" + code), expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  }).select("id").single();
  const { sendOtpEmail } = await import("./email.server");
  const sent = await sendOtpEmail(to, code, `proof-${ver!.id}`);
  await audit({ wallet_id: walletId, app_id: p.appId ?? null, action: sent.ok ? "email_proof_sent" : "otp_send_failed", ip, details: { purpose: p.purpose } });
  return ver!.id;
}

export async function checkEmailProof(where: { id?: string; walletId?: string; purpose: string; userId?: string; appId?: string }, code: string, ip: string | null) {
  let q = db.from("wallet_verifications").select("*").eq("purpose", where.purpose).is("consumed_at", null);
  if (where.id) q = q.eq("id", where.id);
  if (where.walletId) q = q.eq("wallet_id", where.walletId);
  if (where.userId) q = q.eq("user_id", where.userId);
  if (where.appId) q = q.eq("app_id", where.appId);
  const { data: v } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!v) throw new ApiError(400, "no_pending_code");
  await spendAttemptAndCheck(v as Verification, code, { id: v.wallet_id }, v.app_id, ip, where.purpose);
  return v as Verification;
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

export async function executeForWallet(walletId: string, appId: string | null, calls: import("./paymaster").Call[], ip: string | null) {
  await rateLimit(`exec:${walletId}`, 10, 60_000);
  const { data: w } = await db.from("wallets").select("*").eq("id", walletId).single();
  const pk = await openKey(w!.encrypted_private_key);
  const { executeSponsored } = await import("./paymaster.server");
  try {
    const r = await executeSponsored({ address: w!.address, publicKey: w!.public_key, privateKey: pk, deployed: w!.deployed, calls });
    if (!w!.deployed) await db.from("wallets").update({ deployed: true }).eq("id", walletId);
    await audit({ wallet_id: walletId, app_id: appId, action: "executed_transaction", ip, details: { tx_hash: r.transaction_hash, deployed_now: r.deployed_now, calls: calls.length } });
    return { address: w!.address, ...r };
  } catch (e) {
    await audit({ wallet_id: walletId, app_id: appId, action: "transaction_failed", ip, details: { error: String((e as Error).message).slice(0, 500) } });
    throw new ApiError(502, "sponsorship_failed", (e as Error).message);
  }
}

// ---------- Loop Do email linking ----------
async function holdingsOf(w: { id: string; address: string }) {
  const [tok, nft, assets] = await Promise.all([
    db.from("token_holders").select("token_id", { count: "exact", head: true }).eq("address", w.address).gt("balance", 0),
    db.from("nfts").select("id", { count: "exact", head: true }).eq("owner_wallet_id", w.id),
    getAssets(w.address).catch(() => null),
  ]);
  return { tokens: tok.count ?? 0, nfts: nft.count ?? 0, strkRaw: assets ? BigInt(String(assets.balances[0]?.raw ?? "0")) : 1n };
}

/** Move a user onto an unclaimed imported wallet; retire their hub-made wallet only if empty. */
export async function claimImportedWallet(userId: string, email: string, importedId: string, method: string, actor: string | null, anyWallet = false) {
  const { data: imp } = await db.from("wallets").select("*").eq("id", importedId).maybeSingle();
  if (!imp || (!anyWallet && !imp.imported_from?.startsWith("loop-do"))) throw new ApiError(400, "not_an_imported_wallet");
  if (imp.user_id && imp.user_id !== userId) throw new ApiError(409, "already_claimed");
  const seen = new Map<string, NonNullable<typeof imp>>();
  for (const q of [db.from("wallets").select("*").eq("user_id", userId), db.from("wallets").select("*").eq("email", email)]) {
    const { data } = await q;
    for (const c of data ?? []) seen.set(c.id, c);
  }
  for (const c of [...seen.values()].filter((c) => c.id !== imp.id)) {
    if (!canRetireWallet(c, await holdingsOf(c))) throw new ApiError(409, "hub_wallet_not_empty", "The hub-made wallet holds something; an admin must decide.");
    await revokeAllSessions(c.id);
    await db.from("wallets").update({ user_id: null, email: null, retired_email: c.email, retired_at: new Date().toISOString() }).eq("id", c.id);
    await audit({ wallet_id: c.id, action: "wallet_retired", method, details: { replaced_by: imp.id, actor } });
  }
  const proven = isProofMethod(method);
  if (proven) await evictUnverifiedControllers(imp.id, { userId }, null, method);
  const { data } = await db.from("wallets").update({
    user_id: userId, email, retired_email: null, verified: true, verified_method: method, updated_at: new Date().toISOString(),
    ...(proven ? { email_verified_at: new Date().toISOString() } : {}),
  }).eq("id", imp.id).select("*").single();
  await audit({ wallet_id: imp.id, action: "loop_do_wallet_claimed", method, details: { actor } });
  return data!;
}
