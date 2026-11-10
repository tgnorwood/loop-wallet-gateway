// Backfills ERC-20 Transfer history for imported tokens straight from Starknet, then recomputes holders.
import { hash } from "starknet";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseTransferEvents } from "./chain-rules";
import { rpcUrl } from "./paymaster.server";
import { audit } from "./service.server";

const db = supabaseAdmin;
const SEL = hash.getSelectorFromName("Transfer");
const pad = (h: string) => "0x" + BigInt(h).toString(16).padStart(64, "0");

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(rpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

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
      const from = (t.synced_block ?? -1) + 1;
      const target = t.sync_target_block ?? latest;
      if (from > target && !t.sync_continuation) { await db.from("tokens").update({ sync_target_block: latest, synced_at: new Date().toISOString() }).eq("id", t.id); continue; }
      const res = await rpc<{ events: { transaction_hash: string; block_number?: number; keys: string[]; data: string[] }[]; continuation_token?: string }>("starknet_getEvents", {
        filter: { from_block: { block_number: from }, to_block: { block_number: target }, address: pad(t.address!), keys: [[SEL]], chunk_size: 500, ...(t.sync_continuation ? { continuation_token: t.sync_continuation } : {}) },
      });
      pages++;
      const rows = parseTransferEvents(res.events).map((e) => ({ ...e, token_id: t.id }));
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

type PushedToken = { address: string; name: string; symbol: string; creator_user_id?: string; creator_email?: string; swappable?: boolean };
/** Loop Do pushes its token list; each is registered under the "Loop Do" app and queued for chain backfill. */
export async function receiveLoopDoTokens(tokens: PushedToken[], dryRun: boolean) {
  const { data: app } = await db.from("registered_apps").select("id").ilike("name", "loop do").is("revoked_at", null).order("created_at").limit(1).maybeSingle();
  if (!app) throw new Error("Create an app named 'Loop Do' in the Admin page first");
  const out: { address: string; status: string; note?: string }[] = [];
  for (const t of tokens) {
    let address: string;
    try { address = pad(t.address); } catch { out.push({ address: String(t?.address), status: "error", note: "invalid address" }); continue; }
    if (!t.name || !t.symbol) { out.push({ address, status: "error", note: "name and symbol required" }); continue; }
    const { data: ex } = await db.from("tokens").select("id,sync_enabled").eq("network", "sepolia").eq("address", address).maybeSingle();
    if (ex) {
      if (!dryRun && !ex.sync_enabled) await db.from("tokens").update({ sync_enabled: true }).eq("id", ex.id);
      out.push({ address, status: "exists" }); continue;
    }
    if (dryRun) { out.push({ address, status: "would_create" }); continue; }
    const { error } = await db.from("tokens").insert({ app_id: app.id, network: "sepolia", address, name: t.name.slice(0, 100), symbol: t.symbol.slice(0, 20), swappable: !!t.swappable,
      imported_from: "loop-do", creator_ref: (t.creator_email ?? t.creator_user_id ?? null)?.slice(0, 200) ?? null, sync_enabled: true });
    out.push(error ? { address, status: "error", note: error.message } : { address, status: "created" });
  }
  if (!dryRun) await audit({ app_id: app.id, action: "tokens_imported", details: { source: "loop-do-push", received: tokens.length, created: out.filter((r) => r.status === "created").length } });
  return out;
}
