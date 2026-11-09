import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { SignInCard } from "@/components/SignInCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { approveConnect, getAppPublic } from "@/lib/wallet/portal.functions";

type Search = { app?: string; origin?: string; challenge?: string };

export const Route = createFileRoute("/connect")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    app: typeof s.app === "string" ? s.app : undefined,
    origin: typeof s.origin === "string" ? s.origin : undefined,
    challenge: typeof s.challenge === "string" ? s.challenge : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Log in with Loop Wallet" },
      { name: "description", content: "Connect your Loop Wallet to a partner app." },
      { property: "og:title", content: "Log in with Loop Wallet" },
      { property: "og:description", content: "Connect your Loop Wallet to a partner app." },
    ],
  }),
  component: ConnectLayout,
});

function ConnectLayout() {
  const isSign = useMatchRoute()({ to: "/connect/sign" });
  return isSign ? <Outlet /> : <Connect />;
}

export function usePartnerApp(appId?: string) {
  const fetchApp = useServerFn(getAppPublic);
  const [app, setApp] = useState<{ id: string; name: string; popup_enabled: boolean } | null | undefined>(undefined);
  useEffect(() => {
    if (!appId) return setApp(null);
    fetchApp({ data: { appId } }).then(setApp).catch(() => setApp(null));
  }, [appId]);
  return app;
}

export function reply(origin: string, msg: Record<string, unknown>) {
  window.opener?.postMessage({ source: "loop-wallet", ...msg }, origin);
}

function Connect() {
  const { app: appId, origin, challenge } = Route.useSearch();
  const { user, loading } = useAuth();
  const app = usePartnerApp(appId);
  const approve = useServerFn(approveConnect);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!appId || !origin || !challenge) return <Shell><p className="text-destructive">This sign-in link is incomplete.</p></Shell>;
  if (app === undefined || loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!app || !app.popup_enabled) return <Shell><p className="text-destructive">This app can't use Loop Wallet sign-in.</p></Shell>;
  if (!user) return <Shell><SignInCard title={`Log in to ${app.name}`} subtitle="with your Loop Wallet" /></Shell>;

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

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center px-4 py-8">{children}</main>;
}
