// Real dates for chain data. Starknet blocks carry a timestamp; we only store block numbers, so the
// dashboard asks the chain for the time of the few blocks it needs and remembers the answers (a block's
// time never changes).
import { rpcCall } from "./rpc.server";

const known = new Map<number, number>();

export async function blockTime(n: number): Promise<number | null> {
  const hit = known.get(n);
  if (hit !== undefined) return hit;
  try {
    const b = await rpcCall<{ timestamp: number }>("starknet_getBlockWithTxHashes", { block_id: { block_number: n } });
    known.set(n, b.timestamp);
    return b.timestamp;
  } catch { return null; }
}

/** Times for many blocks, a few at a time, stopping when the time budget is spent (the rest come next refresh). */
export async function blockTimes(blocks: number[], opts: { concurrency?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 9_000;
  const todo = [...new Set(blocks)].filter((b) => !known.has(b));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, todo.length) }, async () => {
    while (next < todo.length && Date.now() - started < budget) { const b = todo[next++]!; await blockTime(b); }
  }));
  const out = new Map<number, number>();
  for (const b of blocks) { const t = known.get(b); if (t !== undefined) out.set(b, t); }
  return out;
}

export const dayOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);
