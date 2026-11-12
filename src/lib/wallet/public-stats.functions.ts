import { createServerFn } from "@tanstack/react-start";

/** Aggregate, non-personal numbers for the public dashboard. No emails, no user ids, no private data. */
export type PublicStats = {
  asOf: string;
  network: string;
  latestBlock: number | null;
  totals: { wallets: number; accountsDeployed: number; tokens: number; collections: number; nfts: number; transfers: number; holders: number; sponsoredTx: number; apps: number };
  walletsByDay: { day: string; n: number }[];
  /** Of those, the wallets moved in from Loop Do (by their recorded date). */
  migratedByDay: { day: string; n: number }[];
  txByDay: { day: string; type: string; n: number }[];
  transfersByBlock: { block: number; n: number }[];
  blockBucket: number;
  /** Token transfers grouped by the real date of the blocks they happened in. */
  transfersByDay: { day: string; n: number }[];
  /** When each token was deployed on Starknet (first on-chain event, or creation time for API-made tokens). */
  tokensByDay: { day: string; n: number; names: string[] }[];
  /** Roughly how long one chart point spans, from real block times. */
  hoursPerBucket: number | null;
  topTokens: { name: string; symbol: string; address: string | null; holders: number; transfers: number }[];
  recent: { txHash: string; block: number; from: string; to: string; amount: string; symbol: string }[];
  exact: boolean;
};

const BLOCK_BUCKET = 10_000;
let cache: { at: number; value: PublicStats } | null = null;
let timeline: { at: number; complete: boolean; value: Pick<PublicStats, "transfersByDay" | "tokensByDay" | "hoursPerBucket"> } | null = null;

/** Date-based series built from real block timestamps. Slow-changing, so it is cached for minutes. */
async function buildTimeline(db: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"], buckets: { block: number; n: number }[]) {
  if (timeline && Date.now() - timeline.at < (timeline.complete ? 5 * 60_000 : 20_000)) return timeline.value;
  const { blockTimes, dayOf } = await import("./chain-time.server");

  // First on-chain event per token = when it was deployed (the initial mint). API-made tokens use their creation time.
  const { data: toks } = await db.from("tokens").select("id,name,symbol,created_at,imported_from").eq("is_test", false).limit(400);
  const firstBlock = new Map<string, number>();
  let i = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (i < (toks?.length ?? 0)) {
      const t = toks![i++]!;
      if (!t.imported_from) continue;
      const { data: e } = await db.from("chain_events").select("block_number").eq("token_id", t.id).order("block_number", { ascending: true }).limit(1).maybeSingle();
      if (e) firstBlock.set(t.id, Number(e.block_number));
    }
  }));

  const times = await blockTimes([...buckets.map((b) => b.block), ...firstBlock.values()]);
  const complete = buckets.every((b) => times.has(b.block)) && [...firstBlock.values()].every((b) => times.has(b));

  const perDay = new Map<string, number>();
  for (const b of buckets) { const ts = times.get(b.block); if (ts !== undefined) perDay.set(dayOf(ts), (perDay.get(dayOf(ts)) ?? 0) + b.n); }
  const transfersByDay = [...perDay].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));

  const tokDay = new Map<string, string[]>();
  for (const t of toks ?? []) {
    const fb = firstBlock.get(t.id);
    const ts = fb !== undefined ? times.get(fb) : undefined;
    const day = ts !== undefined ? dayOf(ts) : t.imported_from ? null : t.created_at.slice(0, 10);
    if (!day) continue;
    tokDay.set(day, [...(tokDay.get(day) ?? []), t.symbol || t.name]);
  }
  const tokensByDay = [...tokDay].map(([day, names]) => ({ day, n: names.length, names: names.slice(0, 5) })).sort((a, b) => a.day.localeCompare(b.day));

  const ts = buckets.map((b) => ({ b: b.block, t: times.get(b.block) })).filter((x): x is { b: number; t: number } => x.t !== undefined);
  const hoursPerBucket = ts.length >= 2 ? Math.max(1, Math.round(((ts[ts.length - 1]!.t - ts[0]!.t) / 3600) / ((ts[ts.length - 1]!.b - ts[0]!.b) / BLOCK_BUCKET))) : null;

  const value = { transfersByDay, tokensByDay, hoursPerBucket };
  timeline = { at: Date.now(), complete, value };
  return value;
}

async function compute(): Promise<PublicStats> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const num = (v: unknown) => Number(v ?? 0);

  // Preferred: one database function does the grouping (see docs/lovable-db-changes.md). Falls back to plain queries.
  type Agg = { totals: Record<string, number>; wallets_by_day: { day: string; n: number }[]; tx_by_day: { day: string; type: string; n: number }[]; transfers_by_bucket: { b: number; bucket?: number; n: number }[] };
  let agg: Agg | null = null;
  const r = await (db.rpc as unknown as (n: string) => Promise<{ data: Agg | null; error: unknown }>)("public_dashboard_stats");
  if (!r.error && r.data) agg = r.data;

  let totals: PublicStats["totals"];
  let walletsByDay: PublicStats["walletsByDay"] = [];
  let txByDay: PublicStats["txByDay"] = [];
  let transfersByBlock: PublicStats["transfersByBlock"] = [];

  if (agg) {
    const t = agg.totals;
    totals = { wallets: num(t["wallets"]), accountsDeployed: num(t["accounts_deployed"]), tokens: num(t["tokens"]), collections: num(t["collections"]), nfts: num(t["nfts"]), transfers: num(t["transfers"]), holders: num(t["holders"]), sponsoredTx: num(t["sponsored_tx"]), apps: num(t["apps"]) };
    walletsByDay = (agg.wallets_by_day ?? []).map((x) => ({ day: String(x.day), n: num(x.n) }));
    txByDay = (agg.tx_by_day ?? []).map((x) => ({ day: String(x.day), type: String(x.type), n: num(x.n) }));
    transfersByBlock = (agg.transfers_by_bucket ?? []).map((x) => ({ block: num(x.bucket ?? x.b) * BLOCK_BUCKET, n: num(x.n) }));
  } else {
    const head = (q: PromiseLike<{ count: number | null }>) => q.then((x) => x.count ?? 0);
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const [wallets, deployed, tokens, collections, nfts, transfers, confirmed, executed, apps, tokRows, wRows, tRows] = await Promise.all([
      head(db.from("wallets").select("id", { count: "exact", head: true }).is("retired_at", null)),
      head(db.from("wallets").select("id", { count: "exact", head: true }).eq("deployed", true).is("retired_at", null)),
      head(db.from("tokens").select("id", { count: "exact", head: true }).eq("is_test", false)),
      head(db.from("collections").select("id", { count: "exact", head: true }).eq("is_test", false)),
      head(db.from("nfts").select("id", { count: "exact", head: true })),
      head(db.from("chain_events").select("id", { count: "exact", head: true })),
      head(db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "confirmed")),
      head(db.from("audit_logs").select("id", { count: "exact", head: true }).eq("action", "executed_transaction")),
      head(db.from("registered_apps").select("id", { count: "exact", head: true }).is("revoked_at", null).eq("sandbox", false)),
      db.from("tokens").select("holder_count").eq("is_test", false).limit(1000),
      db.from("wallets").select("created_at").order("created_at").limit(20000),
      db.from("transactions").select("created_at,type").eq("status", "confirmed").gte("created_at", since).limit(20000),
    ]);
    totals = { wallets, accountsDeployed: deployed, tokens, collections, nfts, transfers, holders: (tokRows.data ?? []).reduce((s, x) => s + num(x.holder_count), 0), sponsoredTx: confirmed + executed, apps };
    const wd = new Map<string, number>();
    for (const w of wRows.data ?? []) { const d = w.created_at.slice(0, 10); wd.set(d, (wd.get(d) ?? 0) + 1); }
    walletsByDay = [...wd].map(([day, n]) => ({ day, n }));
    const td = new Map<string, number>();
    for (const x of tRows.data ?? []) { const k = `${x.created_at.slice(0, 10)}|${x.type}`; td.set(k, (td.get(k) ?? 0) + 1); }
    txByDay = [...td].map(([k, n]) => ({ day: k.split("|")[0]!, type: k.split("|")[1]!, n })).sort((a, b) => a.day.localeCompare(b.day));
  }

  const [top, recent] = await Promise.all([
    db.from("tokens").select("name,symbol,address,holder_count,event_count").eq("is_test", false).order("event_count", { ascending: false }).limit(8),
    db.from("chain_events").select("tx_hash,block_number,from_address,to_address,amount,tokens(symbol)").order("block_number", { ascending: false }).limit(12),
  ]);

  let latestBlock: number | null = null;
  try { const { rpcCall } = await import("./rpc.server"); latestBlock = await rpcCall<number>("starknet_blockNumber", []); } catch { /* shown as unavailable */ }

  const { data: mig } = await db.from("wallets").select("created_at").like("imported_from", "loop-do%").is("retired_at", null).limit(20000);
  const md = new Map<string, number>();
  for (const w of mig ?? []) { const d = w.created_at.slice(0, 10); md.set(d, (md.get(d) ?? 0) + 1); }
  const migratedByDay = [...md].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));

  const tl = await buildTimeline(db, transfersByBlock).catch(() => ({ transfersByDay: [], tokensByDay: [], hoursPerBucket: null }));

  return {
    asOf: new Date().toISOString(), network: "Starknet Sepolia", latestBlock, totals, walletsByDay, migratedByDay, txByDay, transfersByBlock, blockBucket: BLOCK_BUCKET, exact: !!agg, ...tl,
    topTokens: (top.data ?? []).map((t) => ({ name: t.name, symbol: t.symbol, address: t.address, holders: num(t.holder_count), transfers: num(t.event_count) })),
    recent: (recent.data ?? []).map((e) => ({ txHash: e.tx_hash, block: num(e.block_number), from: e.from_address, to: e.to_address, amount: String(e.amount), symbol: (e.tokens as unknown as { symbol: string } | null)?.symbol ?? "" })),
  };
}

export const getPublicStats = createServerFn({ method: "POST" }).handler(async () => {
  if (cache && Date.now() - cache.at < 20_000) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
});
