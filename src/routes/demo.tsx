import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AdminOnly } from "@/components/AdminOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sandboxCall } from "@/lib/wallet/portal.functions";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Developer sandbox — Loop Wallet Hub" },
      { name: "description", content: "Try the Loop Wallet partner flow: instant wallets, email codes and takeovers." },
      { property: "og:title", content: "Developer sandbox — Loop Wallet Hub" },
      { property: "og:description", content: "Try the Loop Wallet partner flow: instant wallets, email codes and takeovers." },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <AdminOnly><Demo /></AdminOnly>
    </div>
  );
}

type Log = { label: string; body: unknown };

function Demo() {
  const call = useServerFn(sandboxCall);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [token, setToken] = useState<string | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const push = (label: string, body: unknown) => setLog((l) => [{ label, body }, ...l]);

  async function run(action: "get-or-create" | "verify-otp" | "resend-otp" | "sign") {
    const r = (await call({ data: { action, email, ...(code ? { code } : {}), ...(token ? { token } : {}) } })) as Record<string, unknown>;
    push(`POST /v1/wallet/${action}`, r);
    if (r["session_token"]) { setToken(String(r["session_token"])); setStep("done"); }
    if (r["status"] === "requires_verification") setStep("code");
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-2">
      <div className="rounded-2xl border bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Loop Fans · mock partner</p>
        <h1 className="mt-2 text-2xl font-semibold">Join Loop Fans</h1>
        {step === "email" && (
          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); run("get-or-create"); }}>
            <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="w-full" type="submit">Continue</Button>
            <p className="text-xs text-muted-foreground">New email → wallet instantly. Existing email → 6-digit code.</p>
          </form>
        )}
        {step === "code" && (
          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); run("verify-otp"); }}>
            <p className="text-sm text-muted-foreground">This email already has a wallet. Enter the code we sent (in the sandbox, it appears in the log).</p>
            <Input inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">Verify</Button>
              <Button type="button" variant="secondary" onClick={() => run("resend-otp")}>Resend</Button>
            </div>
          </form>
        )}
        {step === "done" && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-success">Signed in. Session token received.</p>
            <Button className="w-full" onClick={() => run("sign")}>Sign a test message</Button>
            <Button variant="ghost" className="w-full" onClick={() => { setStep("email"); setToken(null); setCode(""); }}>Start over</Button>
          </div>
        )}
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">API log</h2>
        <div className="max-h-[560px] space-y-3 overflow-auto">
          {log.length === 0 && <p className="text-sm text-muted-foreground">Responses appear here.</p>}
          {log.map((l, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-primary">{l.label}</p>
              <pre className="mt-1 overflow-auto rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(l.body, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
