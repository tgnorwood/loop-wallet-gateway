import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { adminStats } from "@/lib/wallet/chain-admin.functions";

const nf = new Intl.NumberFormat("en-US");
const C = ["oklch(0.7 0.19 285)", "oklch(0.78 0.13 200)", "oklch(0.76 0.17 160)", "oklch(0.83 0.16 82)", "oklch(0.72 0.2 350)"];
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export function useAdminStats() {
  const fetchStats = useServerFn(adminStats);
  return useQuery({ queryKey: ["admin-stats"], queryFn: () => fetchStats(), refetchInterval: 60_000, staleTime: 30_000, retry: false });
}
export type AdminStatsData = NonNullable<ReturnType<typeof useAdminStats>["data"]>;

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string | undefined; tone?: "bad" | "warn" | undefined }) {
  const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-400" : "";
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{typeof value === "number" ? nf.format(value) : value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const Pill = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-emerald-500/40 text-emerald-400" : "text-muted-foreground"}`}>{children}</span>
);

export function AdminStats() {
  const { data, isLoading, error } = useAdminStats();
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Admins only.</p>;
  return <StatsView data={data} />;
}

export function StatsView({ data }: { data: AdminStatsData }) {
  const p = data.platform;
  const real = data.apps.filter((a) => !a.sandbox);
  const connected = real.filter((a) => !a.revoked_at);
  const revoked = real.length - connected.length;
  const pct = p.wallets ? Math.round((p.verified / p.wallets) * 100) : 0;
  const totalWallets = connected.reduce((s, a) => s + a.stats.wallets, 0) || 1;
  const chart = connected.map((a) => ({ name: a.name, Confirmed: a.stats.confirmed7d, Failed: a.stats.failed7d }));
  const successRate = p.confirmed7d + p.failed7d ? Math.round((p.confirmed7d / (p.confirmed7d + p.failed7d)) * 100) : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* Connected apps headline */}
      <section className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Connected apps</p>
            <p className="text-5xl font-bold tracking-tight">{connected.length}</p>
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            {connected.map((a, i) => <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: C[i % C.length] }} />{a.name}</span>)}
            {connected.length === 0 && <span className="text-sm text-muted-foreground">No apps connected yet. Add one in the Connected apps tab.</span>}
          </div>
          {revoked > 0 && <p className="pb-1 text-xs text-muted-foreground">{revoked} revoked</p>}
        </div>
        {connected.length > 0 && (
          <div className="mt-5">
            <p className="mb-1.5 text-xs text-muted-foreground">Share of wallets by app</p>
            <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
              {connected.map((a, i) => <div key={a.id} title={`${a.name}: ${nf.format(a.stats.wallets)}`} style={{ width: `${(a.stats.wallets / totalWallets) * 100}%`, background: C[i % C.length] }} />)}
            </div>
          </div>
        )}
      </section>

      {/* Platform numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Wallets" value={p.wallets} hint={`${pct}% with a verified email`} />
        <Tile label="Accounts deployed" value={p.deployed} />
        <Tile label="Tokens" value={p.tokens} />
        <Tile label="NFT collections" value={p.collections} hint={`${nf.format(p.nfts)} NFTs minted`} />
        <Tile label="Token transfers on chain" value={p.transfers} />
        <Tile label="Confirmed (24h)" value={p.confirmed24h} hint={`${nf.format(p.confirmed7d)} in 7 days`} />
        <Tile label="Failed (24h)" value={p.failed24h} tone={p.failed24h ? "bad" : undefined} hint={successRate === null ? undefined : `${successRate}% success over 7 days`} />
        <Tile label="In progress" value={p.inFlight} hint={p.unknown ? `${p.unknown} with an unknown outcome` : "queue is moving"} tone={p.unknown ? "warn" : undefined} />
        <Tile label="Loop Do wallets moved in" value={p.loopDoImported} />
        <Tile label="Signatures (7 days)" value={p.signatures7d} />
        <Tile label="Takeovers (7 days)" value={p.takeovers7d} />
        <Tile label="App notifications waiting" value={p.pendingWebhooks} tone={p.pendingWebhooks ? "warn" : undefined} />
      </div>

      {/* Per app */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Breakdown by app</h2>
        {chart.length > 0 && (
          <div className="mb-4 rounded-xl border bg-card p-4">
            <p className="mb-2 text-sm font-medium">Transactions in the last 7 days</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} cursor={{ fill: "var(--secondary)", opacity: 0.4 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Confirmed" stackId="t" fill={C[2]} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Failed" stackId="t" fill={C[4]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.apps.map((a, i) => {
            const s = a.stats;
            const rate = s.confirmed7d + s.failed7d ? Math.round((s.confirmed7d / (s.confirmed7d + s.failed7d)) * 100) : null;
            return (
              <article key={a.id} className={`rounded-xl border bg-card p-5 ${a.revoked_at ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: C[i % C.length] }} />
                  <h3 className="font-semibold">{a.name}</h3>
                  {a.sandbox && <Pill on={false}>sandbox</Pill>}
                  {a.revoked_at ? <Pill on={false}>revoked</Pill> : (<><Pill on={a.api_enabled}>API</Pill><Pill on={a.popup_enabled}>popup</Pill><Pill on={a.trusted_oauth}>trusted for Google</Pill><Pill on={!!a.webhook_url}>webhook</Pill></>)}
                  <span className="ml-auto text-xs text-muted-foreground">last transaction {ago(s.lastTransactionAt)}</span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Wallets</dt><dd className="text-lg font-semibold">{nf.format(s.wallets)}</dd><dd className="text-xs text-muted-foreground">+{s.wallets24h} today · +{s.wallets7d} this week</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Linked from other apps</dt><dd className="text-lg font-semibold">{nf.format(s.linkedWallets)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">API calls (24h)</dt><dd className="text-lg font-semibold">{nf.format(s.apiCalls24h)}</dd><dd className="text-xs text-muted-foreground">limit {a.rate_limit_per_min}/min</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Tokens</dt><dd className="text-lg font-semibold">{nf.format(s.tokens)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Collections</dt><dd className="text-lg font-semibold">{nf.format(s.collections)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Transactions (7 days)</dt><dd className="text-lg font-semibold">{nf.format(s.tx7d)}</dd><dd className="text-xs text-muted-foreground">{nf.format(s.tx24h)} in 24 h</dd></div>
                </dl>
                <div className="mt-4 flex items-center gap-3 text-xs">
                  <span className="text-emerald-400">{nf.format(s.confirmed7d)} confirmed</span>
                  <span className={s.failed7d ? "text-destructive" : "text-muted-foreground"}>{nf.format(s.failed7d)} failed</span>
                  {rate !== null && <span className="ml-auto text-muted-foreground">{rate}% success</span>}
                </div>
                {rate !== null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${rate}%` }} /></div>}
              </article>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Updated {new Date(data.asOf).toLocaleTimeString()} and refreshed every minute. "Wallets" counts wallets each app created; "linked" are people it shares with another Loop app.</p>
      </section>
    </main>
  );
}
