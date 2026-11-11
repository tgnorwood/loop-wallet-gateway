// Sends OTP emails through Resend (same setup as Loop Do).
export async function sendOtpEmail(to: string, code: string, idempotencyKey: string) {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { ok: false as const, error: "RESEND_API_KEY not configured" };
  const from = process.env["RESEND_FROM_ADDRESS"] || "Loop Wallet <hello@loop.do>";
  const text = `Your Loop Wallet code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px">
<h2 style="margin:0 0 12px">Your Loop Wallet code</h2>
<p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:16px 0">${code}</p>
<p style="color:#555">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject: `Your Loop Wallet code: ${code}`, html, text, tags: [{ name: "kind", value: "otp" }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend failed [${res.status}]: ${body}`);
    return { ok: false as const, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true as const };
}

/** Plain operational alert to ALERT_EMAIL (comma separated). */
export async function sendAlertEmail(subject: string, text: string) {
  const key = process.env["RESEND_API_KEY"];
  const to = (process.env["ALERT_EMAIL"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!key || !to.length) return { ok: false as const, error: "alerts not configured" };
  const from = process.env["RESEND_FROM_ADDRESS"] || "Loop Wallet <hello@loop.do>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `[Loop Wallet] ${subject}`.slice(0, 200), text: text.slice(0, 4000), tags: [{ name: "kind", value: "alert" }] }),
  });
  return res.ok ? { ok: true as const } : { ok: false as const, error: `Resend ${res.status}` };
}
