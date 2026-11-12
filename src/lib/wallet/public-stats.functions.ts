import { createServerFn } from "@tanstack/react-start";

/** Aggregate, non-personal numbers for the public dashboard. No emails, no user ids, no private data. */
export type PublicStats = {
  asOf: string;
  network: string;
  latestBlock: number | null;
  totals: { wallets: number; accountsDeployed: number; tokens: number; collections: number; nfts: number; transfers: number; holders: number; sponsoredTx: number; apps: number };
  walletsByDay: { day: string; n: number }[];
  txByDay: { day: string; type: string; n: number }[];
  transfersByBlock: { block: number; n: number }[];
  blockBucket: number;
  topTokens: { name: string; symbol: string; address: string | null; holders: number; transfers: number }[];
  recent: { txHash: string; block: number; from: string; to: string; amount: string; symbol: string }[];
  exact: boolean;
};

const BLOCK_BUCKET = 10_000;
let cache: { at: number; value: PublicStats } | null = null;

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

  return {
    asOf: new Date().toISOString(), network: "Starknet Sepolia", latestBlock, totals, walletsByDay, txByDay, transfersByBlock, blockBucket: BLOCK_BUCKET, exact: !!agg,
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
