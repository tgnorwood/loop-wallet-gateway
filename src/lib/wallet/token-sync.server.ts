// Backfills ERC-20 Transfer history for imported tokens straight from Starknet, then recomputes holders.
import { hash } from "starknet";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseTransferEvents } from "./chain-rules";
import { rpcCall } from "./rpc.server";

const db = supabaseAdmin;
const SEL = hash.getSelectorFromName("Transfer");
const pad = (h: string) => "0x" + BigInt(h).toString(16).padStart(64, "0");

const rpc = rpcCall;

type Tok = { id: string; address: string | null; synced_block: number | null; sync_target_block: number | null; sync_continuation: string | null };

/** One page per token per call; resumes from the stored cursor. */
export async function syncTokens(budgetMs = 15_000) {
  const start = Date.now(); let pages = 0, events = 0;
  const { data: toks } = await db.from("tokens").select("id,address,synced_block,sync_target_block,sync_continuation").eq("sync_enabled", true).not("address", "is", null).order("synced_at", { ascending: true, nullsFirst: true }).limit(20);
  if (!toks?.length) return { pages, events };
  const latest = await rpc<number>("starknet_blockNumber", []);
  for (const t of toks as Tok[]) {
    if (Date.now() - start > budgetMs) break;
    try {
      // First run: binary-search the deploy block so we don't scan the whole chain (~25 cheap calls).
      if (t.synced_block == null && !t.sync_continuation) {
        let lo = 0, hi = latest;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          const ok = await rpc<string>("starknet_getClassHashAt", { block_id: { block_number: mid }, contract_address: pad(t.address!) }).then(() => true, () => false);
          if (ok) hi = mid; else lo = mid + 1;
        }
        t.synced_block = lo - 1;
        await db.from("tokens").update({ synced_block: t.synced_block }).eq("id", t.id);
      }
      const from = (t.synced_block ?? -1) + 1;
      const target = t.sync_target_block ?? latest;
      if (from > target && !t.sync_continuation) { await db.from("tokens").update({ sync_target_block: latest, synced_at: new Date().toISOString() }).eq("id", t.id); continue; }
      const res = await rpc<{ events: { transaction_hash: string; block_number?: number; keys: string[]; data: string[] }[]; continuation_token?: string }>("starknet_getEvents", {
        filter: { from_block: { block_number: from }, to_block: { block_number: target }, address: pad(t.address!), keys: [[SEL]], chunk_size: 500, ...(t.sync_continuation ? { continuation_token: t.sync_continuation } : {}) },
      });
      pages++;
      const rows = parseTransferEvents(res.events).map((e) => ({ ...e, amount: e.amount as unknown as number, token_id: t.id }));
      if (rows.length) {
        const { error } = await db.from("chain_events").upsert(rows, { onConflict: "token_id,tx_hash,ordinal", ignoreDuplicates: true });
        if (error) throw error;
        events += rows.length;
        await db.rpc("recompute_token_holders", { _token: t.id });
      }
      const done = !res.continuation_token;
      await db.from("tokens").update({
        sync_continuation: res.continuation_token ?? null,
        synced_block: done ? target : t.synced_block,
        sync_target_block: done ? null : target,
        synced_at: new Date().toISOString(), sync_error: null,
      }).eq("id", t.id);
    } catch (e) {
      await db.from("tokens").update({ sync_error: String((e as Error).message).slice(0, 300), synced_at: new Date().toISOString() }).eq("id", t.id);
    }
  }
  return { pages, events };
}
