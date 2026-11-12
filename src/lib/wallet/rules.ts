export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 2 * 60 * 1000;

export type OtpRecord = {
  attempts: number;
  expires_at: string;
  last_sent_at: string;
  consumed_at: string | null;
};

export type OtpCheck = "ok" | "expired" | "too_many_attempts" | "consumed";

export function checkOtpUsable(v: OtpRecord, now = Date.now()): OtpCheck {
  if (v.consumed_at) return "consumed";
  if (new Date(v.expires_at).getTime() <= now) return "expired";
  if (v.attempts >= OTP_MAX_ATTEMPTS) return "too_many_attempts";
  return "ok";
}

export function resendWaitSeconds(v: Pick<OtpRecord, "last_sent_at">, now = Date.now()) {
  const elapsed = now - new Date(v.last_sent_at).getTime();
  return elapsed >= OTP_RESEND_COOLDOWN_MS ? 0 : Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
}

export type SessionRecord = { expires_at: string; revoked_at: string | null };

export function isSessionActive(s: SessionRecord, now = Date.now()) {
  return !s.revoked_at && new Date(s.expires_at).getTime() > now;
}

/** Origin is allowed only if it exactly matches one registered origin. */
export function isOriginAllowed(origin: string | null, allowed: string[]) {
  if (!origin) return false;
  const o = origin.replace(/\/$/, "").toLowerCase();
  return allowed.some((a) => a.replace(/\/$/, "").toLowerCase() === o);
}

/** An imported wallet may take an email only when Loop Do's record matches what was moved in and the email is verified. */
export function canAttachEmail(w: { external_id: string | null; address: string; user_id: string | null; email: string | null } | null, row: { user_id: string; address: string; email_verified: boolean }) {
  if (!w) return "not_found" as const;
  if (!row.email_verified) return "unverified" as const;
  if (w.external_id !== row.user_id || BigInt(w.address) !== BigInt(row.address)) return "mismatch" as const;
  if (w.user_id) return "already_claimed" as const;
  return "ok" as const;
}

/** A hub-made wallet is only retired when it was never deployed and holds nothing. */
export function canRetireWallet(w: { imported_from: string | null; deployed: boolean }, holdings: { tokens: number; nfts: number; strkRaw: bigint }) {
  return !w.imported_from && !w.deployed && holdings.tokens === 0 && holdings.nfts === 0 && holdings.strkRaw === 0n;
}

/** Reusing a wallet that already exists for an email needs a code, unless the person came via Google
 *  (hub Google sign-in, or a partner app the admin trusts for Google). */
export function needsEmailProof(p: { walletExists: boolean; alreadyLinked: boolean; method: "google" | "password" | "other"; appTrustedGoogle: boolean; isHubGoogle?: boolean }) {
  if (!p.walletExists || p.alreadyLinked) return false;
  if (p.method === "google" && (p.isHubGoogle || p.appTrustedGoogle)) return false;
  return true;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/**
 * Is this sign-up's email verified? Only for apps the admin marked "Trusted for Google sign-in", and only when
 * Google signed the person in (Google has already verified the address) or the app says its own sign-in verified it.
 * An untrusted app can claim neither.
 */
export function emailVerifiedEffective(claimed: boolean | undefined, appTrusted: boolean, method?: string) {
  return appTrusted && (claimed === true || method === "google");
}

/**
 * When someone proves they own an email (emailed code, Google), the wallet's previous controllers are
 * removed - but only when that email was never proven before. Imported Loop Do wallets keep their home app.
 */
export function shouldEvictControllers(w: { email_verified_at: string | null; imported_from: string | null }) {
  return !w.email_verified_at && !w.imported_from;
}

/** Sign-in methods that count as proof of owning the email when claiming a wallet. */
export const PROOF_METHODS = ["google", "email_code", "email_otp", "oauth"] as const;
export const isProofMethod = (m: string) => (PROOF_METHODS as readonly string[]).includes(m);

/** Spread new operator work over `lanes` parallel signers: pick the least-loaded one. */
export function pickLane(loadByLane: number[]) {
  let best = 0;
  for (let i = 1; i < loadByLane.length; i++) if ((loadByLane[i] ?? 0) < (loadByLane[best] ?? 0)) best = i;
  return best;
}
export const laneKey = (network: string, lane: number) => `operator:${network}:${lane}`;
export const isOperatorKey = (k: string) => k.startsWith("operator:");
export function laneOf(signerKey: string, network: string) {
  const m = new RegExp(`^operator:${network}:(\\d+)$`).exec(signerKey);
  return m ? Number(m[1]) : null;
}

/** One app must not be able to fill the whole queue and starve the others. */
export function queueFull(queuedForApp: number, cap: number) {
  return queuedForApp >= cap;
}
/** Rough time until a queue of this depth drains, for the Retry-After header. */
export function retryAfterForQueue(queued: number, lanes: number, secondsPerTx = 14) {
  return Math.min(300, Math.max(5, Math.ceil((queued / Math.max(1, lanes)) * secondsPerTx)));
}
