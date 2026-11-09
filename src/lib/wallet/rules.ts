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
