import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { SignInCard } from "@/components/SignInCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { adminImport, adminMarkTest, adminUpdateAppChain, chainDashboard } from "@/lib/wallet/chain-admin.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Chain dashboard — Loop Wallet Hub" },
      { name: "description", content: "Tokens, NFT collections, the transaction log and migrations for every Loop app." },
      { property: "og:title", content: "Chain dashboard — Loop Wallet Hub" },
      { property: "og:description", content: "Tokens, NFT collections, the transaction log and migrations for every Loop app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { user, loading } = useAuth();
  return (
    <div className="min-h-screen">
      <AppHeader />
      {loading ? null : user ? <Dashboard /> : <div className="grid place-items-center py-16"><SignInCard title="Admin sign in" /></div>}
    </div>
  );
}

const short = (a?: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "pending");
const voyager = (kind: "tx" | "contract", v: string) => `https://sepolia.voyager.online/${kind}/${v}`;
const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) => (
  <div className="rounded-xl border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold">{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

function Dashboard() {
  const fetchDash = useServerFn(chainDashboard);
  const [appId, setAppId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [hideTest, setHideTest] = useState(true);
  const { data, error, isLoading } = useQuery({
    queryKey: ["chain-dash", appId, status, hideTest],
    queryFn: () => fetchDash({ data: { appId: appId || null, status: status || null, hideTest } }),
    refetchInterval: 10_000,
    retry: false,
  });
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Admins only.</p>;
  const s = data.stats;
  const appName = (id: string) => data.apps.find((a) => a.id === id)?.name ?? "—";

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {!data.relayConfigured && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          The operator relay key is not set yet, so creating tokens, distributing, creating collections and minting will fail until it is added. Wallet transfers and edits work already.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={appId} onChange={(e) => setAppId(e.target.value)}>
          <option value="">All apps</option>
          {data.apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={hideTest} onCheckedChange={setHideTest} /> Hide test items</label>
        <a className="ml-auto text-sm text-primary underline" href="https://token-factory-console.pages.dev/dashboard" target="_blank" rel="noreferrer">Full on-chain history ↗</a>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Wallets" value={s.wallets} />
        <Stat label="Tokens" value={s.tokens} />
        <Stat label="Collections" value={s.collections} />
        <Stat label="NFTs" value={s.nfts} />
        <Stat label="In progress" value={s.inFlight} />
        <Stat label="Operator queue" value={s.operatorQueue} hint={s.operatorQueue ? `about ${Math.ceil(s.operatorWaitSeconds / 60)} min to clear` : "clear"} />
        <Stat label="Confirmed (24h)" value={s.confirmed24h} />
        <Stat label="Failed (24h)" value={s.failed24h} hint={s.pendingWebhooks ? `${s.pendingWebhooks} app notifications waiting` : undefined} />
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Activity log</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="apps">Apps</TabsTrigger>
          <TabsTrigger value="import">Move wallets in</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex gap-2 text-sm">
            {["", "queued", "submitted", "confirmed", "failed"].map((st) => (
              <Button key={st} size="sm" variant={status === st ? "default" : "outline"} onClick={() => setStatus(st)}>{st || "all"}</Button>
            ))}
          </div>
          {data.transactions.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {data.transactions.map((t) => (
            <div key={t.id} className="grid grid-cols-[1fr_auto] gap-2 border-t py-2 text-sm sm:grid-cols-[140px_160px_1fr_auto]">
              <span className="text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
              <span className="font-medium">{t.type}</span>
              <span className="text-muted-foreground">{appName(t.app_id)}{t.error_code ? ` · ${t.error_code}: ${t.error_message ?? ""}` : ""}</span>
              <span className="flex items-center gap-2">
                <span className={t.status === "failed" ? "text-destructive" : t.status === "confirmed" ? "text-primary" : "text-muted-foreground"}>{t.status}</span>
                {t.tx_hash && <a className="underline" href={voyager("tx", t.tx_hash)} target="_blank" rel="noreferrer">view</a>}
              </span>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="tokens" className="rounded-xl border bg-card p-4">
          <ItemList kind="token" items={data.tokens} appName={appName} />
        </TabsContent>
        <TabsContent value="collections" className="rounded-xl border bg-card p-4">
          <ItemList kind="collection" items={data.collections} appName={appName} />
        </TabsContent>
        <TabsContent value="apps" className="space-y-4">
          {data.apps.map((a) => <AppSettings key={a.id} app={a} />)}
          {data.apps.length === 0 && <p className="text-sm text-muted-foreground">Create apps on the Admin page first.</p>}
        </TabsContent>
        <TabsContent value="import">
          <Import apps={data.apps} loopDoReady={data.loopDoSecretConfigured} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ItemList({ kind, items, appName }: { kind: "token" | "collection"; items: { id: string; app_id: string; name: string; symbol: string; address: string | null; is_test: boolean }[]; appName: (id: string) => string }) {
  const mark = useServerFn(adminMarkTest);
  const qc = useQueryClient();
  if (!items.length) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <>
      {items.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
          <span className="font-medium">{i.name} <span className="text-muted-foreground">({i.symbol})</span></span>
          <span className="text-muted-foreground">{appName(i.app_id)}</span>
          {i.address ? <a className="font-mono text-xs underline" href={voyager("contract", i.address)} target="_blank" rel="noreferrer">{short(i.address)}</a> : <span className="text-xs text-muted-foreground">being created</span>}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            test
            <Switch checked={i.is_test} onCheckedChange={async (v) => { await mark({ data: { kind, id: i.id, isTest: v } }); qc.invalidateQueries({ queryKey: ["chain-dash"] }); }} />
          </label>
        </div>
      ))}
    </>
  );
}

type AppRow = Awaited<ReturnType<typeof chainDashboard>>["apps"][number];
function AppSettings({ app }: { app: AppRow }) {
  const update = useServerFn(adminUpdateAppChain);
  const qc = useQueryClient();
  const [hook, setHook] = useState(app.webhook_url ?? "");
  const [mintCap, setMintCap] = useState(app.daily_mint_cap?.toString() ?? "");
  const [distCap, setDistCap] = useState(app.daily_distribute_cap?.toString() ?? "");
  const [rate, setRate] = useState(String(app.rate_limit_per_min));
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const save = async (extra: { rotateWebhookSecret?: boolean; rotateApiKey?: boolean } = {}) => {
    try {
      const r = await update({ data: { id: app.id, webhook_url: hook || null, daily_mint_cap: mintCap ? Number(mintCap) : null, daily_distribute_cap: distCap ? Number(distCap) : null, rate_limit_per_min: Number(rate) || 60, ...extra } });
      if (r.webhookSecret) setShown({ label: "Webhook secret", value: r.webhookSecret });
      if (r.apiKey) setShown({ label: "New API key (old one stops working now)", value: r.apiKey });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["chain-dash"] });
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">{app.name}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Webhook address<Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://yourapp.com/api/wallet-events" /></label>
        <label className="text-sm">Requests per minute<Input value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label className="text-sm">Daily mint limit (tokens)<Input value={mintCap} onChange={(e) => setMintCap(e.target.value)} placeholder="no limit" /></label>
        <label className="text-sm">Daily give-out limit (tokens)<Input value={distCap} onChange={(e) => setDistCap(e.target.value)} placeholder="no limit" /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save()}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => save({ rotateWebhookSecret: true })}>New webhook secret</Button>
        <Button size="sm" variant="outline" onClick={() => { if (confirm("Issue a new API key? The current key stops working immediately.")) save({ rotateApiKey: true }); }}>New API key</Button>
      </div>
      {shown && (
        <div className="rounded-md border bg-muted p-3 text-sm">
          <p className="font-medium">{shown.label} — copy it now, it won't be shown again</p>
          <code className="break-all">{shown.value}</code>
        </div>
      )}
    </section>
  );
}

function Import({ apps, loopDoReady }: { apps: AppRow[]; loopDoReady: boolean }) {
  const run = useServerFn(adminImport);
  const [appId, setAppId] = useState(apps[0]?.id ?? "");
  const [mode, setMode] = useState<"loop-do-wallets" | "new-wallets" | "tokens">("loop-do-wallets");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<{ externalId: string; status: string; address?: string; note?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const help = {
    "loop-do-wallets": "Columns: user_id,address,private_key,email — exported from Loop Do. Each key is checked against its address before import, so balances stay. Delete the export file afterwards.",
    "new-wallets": "Columns: external_id,email,kind — e.g. Loop Fans fans. Each gets a new wallet.",
    tokens: "Columns: address,name,symbol,swappable — existing Loop Do tokens to manage from here.",
  }[mode];
  const go = async (dryRun: boolean) => {
    setBusy(true);
    try { const r = await run({ data: { appId, mode, csv, dryRun } }); setRows(r.rows); toast.success(dryRun ? "Preview ready" : "Imported"); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap gap-3">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={appId} onChange={(e) => setAppId(e.target.value)}>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="loop-do-wallets">Loop Do wallets</option>
          <option value="new-wallets">New wallets (Loop Fans etc.)</option>
          <option value="tokens">Existing tokens</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">{help}</p>
      {mode === "loop-do-wallets" && !loopDoReady && null}
      <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paste CSV here, first line = column names" className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || !appId || !csv} onClick={() => go(true)}>Preview</Button>
        <Button disabled={busy || !appId || !csv} onClick={() => { if (confirm("Import these rows?")) go(false); }}>Import</Button>
      </div>
      {rows.length > 0 && (
        <div className="max-h-96 overflow-auto text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-3 border-t py-1">
              <span className="w-48 truncate">{r.externalId}</span>
              <span className={r.status === "error" || r.status === "mismatch" ? "text-destructive" : ""}>{r.status}</span>
              <span className="font-mono text-xs text-muted-foreground">{short(r.address)}</span>
              <span className="text-muted-foreground">{r.note}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
