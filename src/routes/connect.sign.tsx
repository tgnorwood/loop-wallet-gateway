import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { SignInCard } from "@/components/SignInCard";
import { useAuth } from "@/hooks/use-auth";
import { approveSign } from "@/lib/wallet/portal.functions";
import { Shell, reply, usePartnerApp } from "./connect";

export const Route = createFileRoute("/connect/sign")({
  head: () => ({
    meta: [
      { title: "Approve signature — Loop Wallet" },
      { name: "description", content: "Review and approve a signature request." },
      { property: "og:title", content: "Approve signature — Loop Wallet" },
      { property: "og:description", content: "Review and approve a signature request." },
    ],
  }),
  component: SignPopup,
});

function SignPopup() {
  const { app: appId, origin } = Route.useSearch() as { app?: string; origin?: string };
  const { user, loading } = useAuth();
  const app = usePartnerApp(appId);
  const sign = useServerFn(approveSign);
  const [typed, setTyped] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Partner sends the typed data via postMessage after the popup announces it is ready.
  useEffect(() => {
    if (!origin) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== new URL(origin).origin) return;
      if (e.data?.source === "loop-wallet-sdk" && e.data.type === "sign_request") setTyped(e.data.typedData);
    };
    window.addEventListener("message", onMsg);
    reply(origin, { type: "ready" });
    return () => window.removeEventListener("message", onMsg);
  }, [origin]);

  if (!appId || !origin) return <Shell><p className="text-destructive">This request is incomplete.</p></Shell>;
  if (app === undefined || loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!app) return <Shell><p className="text-destructive">Unknown app.</p></Shell>;
  if (!user) return <Shell><SignInCard title={`Sign in to approve for ${app.name}`} /></Shell>;

  return (
    <Shell>
      <div className="w-full max-w-md rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">{app.name} wants you to sign</h1>
        <p className="mt-1 text-xs text-muted-foreground">{new URL(origin).host}</p>
        <pre className="mt-4 max-h-64 overflow-auto rounded bg-muted p-3 font-mono text-xs">
          {typed ? JSON.stringify((typed as { message?: unknown }).message ?? typed, null, 2) : "Waiting for request…"}
        </pre>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => { reply(origin, { type: "cancel" }); window.close(); }}>Reject</Button>
          <Button
            className="flex-1"
            disabled={!typed}
            onClick={async () => {
              try {
                const r = await sign({ data: { appId, origin, typedData: typed } });
                reply(origin, { type: "signature", ...r });
                window.close();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Sign
          </Button>
        </div>
      </div>
    </Shell>
  );
}
