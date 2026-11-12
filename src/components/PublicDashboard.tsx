import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, Boxes, Coins, Fuel, Image as ImageIcon, KeyRound, Rocket, ShieldCheck, Users, Wallet, Zap } from "lucide-react";
import { getPublicStats, type PublicStats } from "@/lib/wallet/public-stats.functions";
import { fromBaseUnits } from "@/lib/wallet/chain-rules";

const nf = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const voyager = (kind: "tx" | "contract", v: string) => `https://sepolia.voyager.online/${kind}/${v}`;
// Own palette (vivid on the dark background; the app theme's chart tokens are tuned for light mode).
const COLORS = ["oklch(0.7 0.19 285)", "oklch(0.78 0.13 200)", "oklch(0.76 0.17 160)", "oklch(0.83 0.16 82)", "oklch(0.72 0.2 350)"];
const [C1, C2] = COLORS as [string, string, ...string[]];
const TYPE_LABEL: Record<string, string> = {
  "token.create": "Token created", "token.mint": "Tokens minted", "token.distribute": "Tokens distributed", transfer: "Transfers", return: "Returns", swap: "Swaps",
  "collection.create": "Collection created", "nft.mint": "NFT minted", "nft.transfer": "NFT transfers", "nft.update": "NFT updates",
};
const label = (t: string) => TYPE_LABEL[t] ?? t.replace(/[._]/g, " ");

function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(target); return undefined; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(a + (target - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Counter({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={className}>{nf.format(v)}</span>;
}

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--foreground)" } as const;
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur ${className}`}>
      <h3 className="font-semibold">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-56 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">{children}</div>
);

function Kpi({ icon: Icon, label: l, value, hint, tone }: { icon: typeof Wallet; label: string; value: number; hint?: string; tone: number }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card/60 p-4 backdrop-blur transition-colors hover:bg-card">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ background: COLORS[tone % COLORS.length] }} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" style={{ color: COLORS[tone % COLORS.length] }} />{l}</div>
      <p className="mt-2 text-3xl font-semibold tracking-tight"><Counter value={value} /></p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PublicDashboard() {
  const fetchStats = useServerFn(getPublicStats);
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["public-stats"], queryFn: () => fetchStats(), refetchInterval: 30_000, staleTime: 15_000 });

  if (isLoading) return <Loading />;
  if (error || !data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="text-muted-foreground">The live numbers could not be loaded.</p>
        <button className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary" onClick={() => void refetch()}>Try again</button>
      </main>
    );
  }
  return <Loaded s={data} />;
}

function Loading() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <div className="h-44 animate-pulse rounded-3xl bg-card/60" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-card/60" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-card/60" />)}</div>
    </main>
  );
}

function Loaded({ s }: { s: PublicStats }) {
  const t = s.totals;

  // Two layers: wallets created in the wallet system, and wallets migrated in from Loop Do. The totals add up to all wallets.
  const growth = useMemo(() => {
    const days = [...new Set([...s.walletsByDay.map((d) => d.day), ...s.migratedByDay.map((d) => d.day)])].sort();
    const all = new Map(s.walletsByDay.map((d) => [d.day, d.n]));
    const mig = new Map(s.migratedByDay.map((d) => [d.day, d.n]));
    let a = 0, m = 0;
    return days.map((day) => { const mi = mig.get(day) ?? 0; a += (all.get(day) ?? 0) - mi; m += mi; return { day, created: a, migrated: m }; });
  }, [s.walletsByDay, s.migratedByDay]);

  const { txRows, txTypes, mix } = useMemo(() => {
    const days = [...new Set(s.txByDay.map((x) => x.day))].sort();
    const types = [...new Set(s.txByDay.map((x) => x.type))];
    const rows = days.map((day) => {
      const row: Record<string, string | number> = { day };
      for (const ty of types) row[ty] = s.txByDay.find((x) => x.day === day && x.type === ty)?.n ?? 0;
      return row;
    });
    const m = types.map((ty) => ({ name: label(ty), value: s.txByDay.filter((x) => x.type === ty).reduce((a, x) => a + x.n, 0) })).sort((a, b) => b.value - a.value);
    return { txRows: rows, txTypes: types, mix: m };
  }, [s.txByDay]);

  const tokenGrowth = useMemo(() => {
    let run = 0;
    return s.tokensByDay.map((d) => ({ day: d.day, names: d.names, total: (run += d.n) }));
  }, [s.tokensByDay]);
  const maxTok = Math.max(1, ...s.topTokens.map((x) => x.transfers));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border bg-[radial-gradient(ellipse_at_top_left,oklch(0.42_0.2_275/0.55),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.55_0.15_200/0.4),transparent_50%)] p-6 sm:p-10">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/50 px-3 py-1 backdrop-blur">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
            Live on {s.network}
          </span>
          {s.latestBlock != null && <span className="rounded-full border bg-background/50 px-3 py-1 font-mono backdrop-blur">block {nf.format(s.latestBlock)}</span>}
        </div>
        <h1 className="mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">One wallet for every Loop app, running on Starknet.</h1>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <div><Counter value={t.wallets} className="text-4xl font-bold tracking-tight sm:text-5xl" /><p className="mt-1 text-sm text-muted-foreground">wallets created</p></div>
          <div><Counter value={t.transfers} className="text-4xl font-bold tracking-tight sm:text-5xl" /><p className="mt-1 text-sm text-muted-foreground">token transfers on Starknet</p></div>
          <div><Counter value={t.sponsoredTx} className="text-4xl font-bold tracking-tight sm:text-5xl" /><p className="mt-1 text-sm text-muted-foreground">gas-free transactions sponsored</p></div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Wallet} label="Wallets" value={t.wallets} tone={0} hint="Custodial Starknet accounts" />
        <Kpi icon={Rocket} label="Accounts deployed" value={t.accountsDeployed} tone={1} hint="Deployed on first use" />
        <Kpi icon={ArrowLeftRight} label="Token transfers" value={t.transfers} tone={2} hint="Indexed from chain events" />
        <Kpi icon={Zap} label="Sponsored transactions" value={t.sponsoredTx} tone={3} hint="Users never hold gas" />
        <Kpi icon={Coins} label="Tokens" value={t.tokens} tone={0} hint="ERC-20 from our factory" />
        <Kpi icon={Boxes} label="NFT collections" value={t.collections} tone={1} hint="ERC-721 with royalties" />
        <Kpi icon={ImageIcon} label="NFTs minted" value={t.nfts} tone={2} hint="Metadata stored on-chain" />
        <Kpi icon={Users} label="Token holders" value={t.holders} tone={3} hint="Addresses holding tokens" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Wallet growth" subtitle="Created in the wallet system, plus wallets migrated in from Loop Do">
          {growth.length < 2 ? <Empty>Growth appears once wallets span more than a day.</Empty> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growth} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C1} stopOpacity={0.55} /><stop offset="100%" stopColor={C1} stopOpacity={0.05} /></linearGradient>
                    <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C2} stopOpacity={0.5} /><stop offset="100%" stopColor={C2} stopOpacity={0.05} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis {...axis} tickFormatter={(v: number) => compact.format(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [nf.format(v), n]} labelFormatter={(d: string) => d} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="migrated" name="Migrated from Loop Do" stackId="w" stroke={C2} strokeWidth={2} fill="url(#gm)" />
                  <Area type="monotone" dataKey="created" name="Created in the wallet system" stackId="w" stroke={C1} strokeWidth={2} fill="url(#gw)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" title="What people do" subtitle="Confirmed on-chain actions by type">
          {mix.length === 0 ? <Empty>Activity will appear here.</Empty> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="var(--card)">
                    {mix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => nf.format(v)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3" title="Token transfers on Starknet" subtitle="Per day, from the first token we deployed (dates from Starknet block times)">
          {s.transfersByDay.length === 0 ? <Empty>Transfer history is still being indexed.</Empty> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.transfersByDay} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C2} stopOpacity={0.5} /><stop offset="100%" stopColor={C2} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis {...axis} tickFormatter={(v: number) => compact.format(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [nf.format(v), "Transfers"]} labelFormatter={(d: string) => d} />
                  <Area type="monotone" dataKey="n" stroke={C2} strokeWidth={2.5} fill="url(#gt)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" title="Tokens deployed" subtitle="Cumulative, by the day each went on-chain">
          {tokenGrowth.length === 0 ? <Empty>No tokens yet.</Empty> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tokenGrowth} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs><linearGradient id="gk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS[2]} stopOpacity={0.5} /><stop offset="100%" stopColor={COLORS[2]} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [nf.format(v), "Tokens"]} labelFormatter={(d: string, p) => { const names = (p?.[0]?.payload as { names?: string[] } | undefined)?.names; return names?.length ? `${d} · new: ${names.join(", ")}` : d; }} />
                  <Area type="stepAfter" dataKey="total" stroke={COLORS[2]} strokeWidth={2.5} fill="url(#gk)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5" title="Actions through the wallet API" subtitle="Confirmed transactions per day since the API launched">
          {txRows.length === 0 ? <Empty>No confirmed transactions in this period yet.</Empty> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={txRows} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--secondary)", opacity: 0.4 }} />
                  {txTypes.map((ty, i) => <Bar key={ty} dataKey={ty} name={label(ty)} stackId="a" fill={COLORS[i % COLORS.length]} radius={i === txTypes.length - 1 ? [4, 4, 0, 0] : 0} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Tokens + live feed */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Most active tokens" subtitle="By number of transfers">
          {s.topTokens.length === 0 ? <Empty>No tokens yet.</Empty> : (
            <ul className="space-y-3">
              {s.topTokens.map((tk) => (
                <li key={tk.address ?? tk.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{tk.name} <span className="text-muted-foreground">{tk.symbol}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{nf.format(tk.transfers)} transfers · {nf.format(tk.holders)} holders</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (tk.transfers / maxTok) * 100)}%`, background: `linear-gradient(90deg, ${C1}, ${C2})` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Latest on-chain activity" subtitle="Newest token transfers, straight from Starknet">
          {s.recent.length === 0 ? <Empty>Waiting for activity.</Empty> : (
            <ul className="divide-y text-sm">
              {s.recent.map((e, i) => (
                <li key={`${e.txHash}-${i}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate"><span className="font-medium">{fromBaseUnits(e.amount).replace(/(\.\d{3})\d+$/, "$1")} {e.symbol}</span> <span className="text-muted-foreground">to</span> <span className="font-mono text-xs">{short(e.to)}</span></p>
                    <p className="font-mono text-xs text-muted-foreground">block {nf.format(e.block)}</p>
                  </div>
                  <a className="shrink-0 text-xs text-primary underline" href={voyager("tx", e.txHash)} target="_blank" rel="noreferrer">Voyager ↗</a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Why Starknet */}
      <section className="rounded-2xl border bg-card/60 p-6 backdrop-blur">
        <h2 className="text-lg font-semibold">Built on what makes Starknet different</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: KeyRound, t: "Account abstraction", d: "Every user wallet is a native Starknet account (SNIP-9), created without the user touching a key." },
            { icon: Fuel, t: "Gas-free for users", d: "A paymaster covers fees, so first-time users transact immediately. Accounts deploy on first use." },
            { icon: Coins, t: "Token factory", d: "ERC-20 tokens, distribution, returns and swaps run through a single factory contract." },
            { icon: ShieldCheck, t: "NFT factory", d: "ERC-721 collections with on-chain metadata, freezing and royalties (ERC-2981)." },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border bg-background/40 p-4">
              <f.icon className="h-5 w-5" style={{ color: C2 }} />
              <p className="mt-3 font-medium">{f.t}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="pb-6 text-center text-xs text-muted-foreground">
        Aggregate figures only, from Loop's apps and {s.network}. Updated {new Date(s.asOf).toLocaleTimeString()} and refreshed every 30 seconds.
      </p>
    </main>
  );
}
