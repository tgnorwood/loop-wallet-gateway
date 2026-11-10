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
