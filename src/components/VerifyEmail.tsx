import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalSendCode, portalVerifyCode } from "@/lib/wallet/portal.functions";

/** Shown when the signed-in email already has a wallet and the person did not sign in with Google: they prove the email with a 6-digit code. */
export function VerifyEmail({ email, onVerified, embedded = false }: { email: string; onVerified: () => void; embedded?: boolean }) {
  const send = useServerFn(portalSendCode);
  const verify = useServerFn(portalVerifyCode);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((n) => n - 1), 1000); return () => { clearTimeout(t); }; }, [wait]);
  async function sendCode() {
    setBusy(true);
    const r = await send().catch((e) => ({ ok: false, error: (e as Error).message, alreadyLinked: false }));
    setBusy(false);
    if (r.alreadyLinked) { onVerified(); return; }
    if (!r.ok) { toast.error("error" in r ? r.error : "Couldn't send code"); return; }
    setSent(true); setWait(60); toast.success("Code sent");
  }
  async function check() {
    setBusy(true);
    const r = await verify({ data: { code } }).catch((e) => ({ ok: false, error: (e as Error).message }));
    setBusy(false);
    if (!r.ok) { toast.error("error" in r && r.error === "Incorrect code" ? "That code isn't right" : ("error" in r ? r.error : "Failed")); return; }
    toast.success("Wallet unlocked");
    onVerified();
  }
  const card = (
    <section className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Check your email</h2>
      <p className="text-sm text-muted-foreground">A wallet already exists for <span className="font-medium text-foreground">{email}</span>. To prove it's yours, we'll email you a 6-digit code.</p>
      {!sent ? (
        <Button className="w-full" disabled={busy} onClick={sendCode}>Send code</Button>
      ) : (
        <div className="space-y-3">
          <Input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <Button className="w-full" disabled={busy || code.length !== 6} onClick={check}>Verify</Button>
          <Button variant="ghost" className="w-full" disabled={busy || wait > 0} onClick={sendCode}>{wait > 0 ? `Resend in ${wait}s` : "Resend code"}</Button>
        </div>
      )}
    </section>
  );
  return embedded ? card : <main className="mx-auto max-w-md px-4 py-16">{card}</main>;
}
