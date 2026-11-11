import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ShieldCheck, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SignInCard } from "@/components/SignInCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromBaseUnits } from "@/lib/wallet/chain-rules";
import { useAuth } from "@/hooks/use-auth";
import { disconnectApp, getPortal, signOutEverywhere } from "@/lib/wallet/portal.functions";
import { VerifyEmail } from "@/components/VerifyEmail";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your wallet — Loop Wallet Hub" },
      { name: "description", content: "See your Starknet wallet, balances, activity and connected apps." },
      { property: "og:title", content: "Your wallet — Loop Wallet Hub" },
      { property: "og:description", content: "See your Starknet wallet, balances, activity and connected apps." },
    ],
  }),
  component: Portal,
});

function Portal() {
  const { user, loading } = useAuth();
  return (
    <div className="min-h-screen">
      <AppHeader />
      {loading ? null : user ? (
        <Dashboard />
      ) : (
        <main className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Starknet · Sepolia</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight md:text-5xl">One wallet for every Loop app.</h1>
            <p className="mt-4 max-w-md text-muted-foreground">
              Sign in to see your address, balances, collectibles and every app you've connected. Your keys never leave the hub.
            </p>
          </div>
          <SignInCard />
        </main>
      )}
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function Dashboard() {
  const fetchPortal = useServerFn(getPortal);
  const signOutAll = useServerFn(signOutEverywhere);
  const disconnect = useServerFn(disconnectApp);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["portal"], queryFn: () => fetchPortal() });

  if (isLoading) return <p className="p-8 text-muted-foreground">Loading your wallet…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Couldn't load your wallet: {String((error as Error)?.message)}</p>;
  if (data.needsVerification) return <VerifyEmail email={data.email} onVerified={() => void qc.invalidateQueries({ queryKey: ["portal"] })} />;
  const strk = Number(BigInt(data.assets.balances[0]?.raw ?? "0") / 10n ** 14n) / 10000;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <section className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{data.wallet.email}</p>
            <button
              className="mt-1 flex items-center gap-2 font-mono text-lg"
              onClick={() => {
                navigator.clipboard.writeText(data.wallet.address);
                toast.success("Address copied");
              }}
            >
              {short(data.wallet.address)} <Copy className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="mt-2 flex gap-2 text-xs">
              {data.wallet.verified ? (
                <span className="flex items-center gap-1 rounded bg-success/15 px-2 py-0.5 text-success"><ShieldCheck className="h-3 w-3" />Verified owner</span>
              ) : (
                <span className="flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-destructive"><ShieldAlert className="h-3 w-3" />Unverified</span>
              )}
              <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">{data.wallet.deployed ? "Deployed" : "Deploys on first action"}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">STRK balance</p>
            <p className="text-3xl font-semibold">{strk}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Tokens">
          {data.tokens.length === 0 ? <Empty>No tokens yet.</Empty> : data.tokens.map((t) => (
            <Row key={t.symbol + t.address} left={`${t.name} (${t.symbol})`} right={fromBaseUnits(BigInt(t.balance.split(".")[0]!), t.decimals)} />
          ))}
        </Panel>
        <Panel title="NFTs">
          {data.nfts.length === 0 ? <Empty>No NFTs yet.</Empty> : data.nfts.map((n) => (
            <Row key={n.id} left={n.collection} right={`#${n.tokenId}`} />
          ))}
        </Panel>
        <Panel title="Points & badges">
          {data.assets.items.length === 0 ? <Empty>Nothing yet. Apps you use can add points and badges here.</Empty> : data.assets.items.map((i, k) => (
            <Row key={k} left={i.name} right={`${i.amount} ${i.kind}`} />
          ))}
        </Panel>
        <Panel title="Connected apps">
          {data.connections.length === 0 ? <Empty>No apps connected.</Empty> : data.connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 text-sm">
              <span>{(c.registered_apps as { name: string } | null)?.name}</span>
              <Button size="sm" variant="ghost" onClick={async () => { await disconnect({ data: { connectionId: c.id } }); qc.invalidateQueries({ queryKey: ["portal"] }); toast.success("Disconnected"); }}>Disconnect</Button>
            </div>
          ))}
        </Panel>
        <Panel
          title="Active sessions"
          action={
            <Button size="sm" variant="destructive" onClick={async () => { await signOutAll(); qc.invalidateQueries({ queryKey: ["portal"] }); toast.success("All app sessions signed out"); }}>
              Sign out everywhere
            </Button>
          }
        >
          {data.sessions.length === 0 ? <Empty>No active app sessions.</Empty> : data.sessions.map((s) => (
            <Row key={s.id} left={(s.registered_apps as { name: string } | null)?.name ?? "Hub"} right={`${s.ip ?? "unknown IP"} · ${new Date(s.created_at).toLocaleString()}`} />
          ))}
        </Panel>
        <Panel title="Recent activity">
          {data.activity.map((a) => (
            <Row key={a.id} left={a.action.replace(/_/g, " ")} right={new Date(a.created_at).toLocaleString()} />
          ))}
        </Panel>
      </div>
    </main>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{title}</h2>{action}</div>
      <div className="divide-y">{children}</div>
    </section>
  );
}
const Row = ({ left, right }: { left: string; right: string }) => (
  <div className="flex justify-between gap-4 py-2 text-sm"><span className="capitalize">{left}</span><span className="text-muted-foreground">{right}</span></div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-2 text-sm text-muted-foreground">{children}</p>;
