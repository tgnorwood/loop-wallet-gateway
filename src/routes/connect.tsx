import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { SignInCard } from "@/components/SignInCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { approveConnect } from "@/lib/wallet/portal.functions";
import { Shell, reply, usePartnerApp } from "@/components/connect-shared";
import { VerifyEmail } from "@/components/VerifyEmail";

type Search = { app?: string; origin?: string; challenge?: string };

export const Route = createFileRoute("/connect")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["app"] === "string" ? { app: s["app"] } : {}),
    ...(typeof s["origin"] === "string" ? { origin: s["origin"] } : {}),
    ...(typeof s["challenge"] === "string" ? { challenge: s["challenge"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Log in with Loop Wallet" },
      { name: "description", content: "Connect your Loop Wallet to a partner app." },
      { property: "og:title", content: "Log in with Loop Wallet" },
      { property: "og:description", content: "Connect your Loop Wallet to a partner app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectLayout,
});

function ConnectLayout() {
  const isSign = useMatchRoute()({ to: "/connect/sign" });
  return isSign ? <Outlet /> : <Connect />;
}

function Connect() {
  const { app: appId, origin, challenge } = Route.useSearch();
  const { user, loading } = useAuth();
  const app = usePartnerApp(appId);
  const approve = useServerFn(approveConnect);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  if (!appId || !origin || !challenge) return <Shell><p className="text-destructive">This sign-in link is incomplete.</p></Shell>;
  if (app === undefined || loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!app || !app.popup_enabled) return <Shell><p className="text-destructive">This app can't use Loop Wallet sign-in.</p></Shell>;
  if (!user) return <Shell><SignInCard title={`Log in to ${app.name}`} subtitle="with your Loop Wallet" /></Shell>;

  if (verifyEmail) return <Shell><VerifyEmail embedded email={verifyEmail} onVerified={() => setVerifyEmail(null)} /></Shell>;

  return (
    <Shell>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        <h1 className="mt-2 text-xl font-semibold">Connect {app.name} to your wallet</h1>
        <p className="mt-1 text-xs text-muted-foreground">{new URL(origin).host}</p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>• See your wallet address</li>
          <li>• Ask you to approve signatures</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">It never gets your private key. You can disconnect anytime from your portal.</p>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => { reply(origin, { type: "cancel" }); window.close(); }}>Cancel</Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await approve({ data: { appId, origin, challenge } });
                if (r.needsVerification) { setVerifyEmail(r.email); return; }
                reply(origin, { type: "code", code: r.code, address: r.address });
                window.close();
              } catch (e) {
                setErr((e as Error).message.includes("origin") ? "This website isn't registered for this app." : (e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve
          </Button>
        </div>
        <button className="mt-4 text-xs text-muted-foreground hover:text-foreground" onClick={() => supabase.auth.signOut()}>Use a different account</button>
      </div>
    </Shell>
  );
}

