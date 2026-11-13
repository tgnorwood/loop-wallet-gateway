// Finds the transaction for a request on Starknet itself, from what the request was (which token, who to,
// how much), when the hub lost the reply and never learned the hash. Server-only; no database access here.
import { hash } from "starknet";
import { rpcCall } from "./rpc.server";
import { blockTime } from "./chain-time.server";

const norm = (a: string) => "0x" + BigInt(a).toString(16);
const sel = (name: string) => hash.getSelectorFromName(name);

export type EvidenceSpec = {
  /** Contract that emits the event. */
  address: string;
  /** Key filter, one list per key position. */
  keys: string[][];
  /** Where the u256 amount starts in the event data, and its expected value. */
  amount?: { offset: number; raw: string };
};

type Req = { type: string; r: Record<string, string | undefined>; factory: string; walletAddress: string | null };

/**
 * What event proves this kind of request happened? null = we cannot tell for this type
 * (for example token or collection creation, which have no unique recipient or amount to match).
 */
export function evidenceSpec(p: Req): EvidenceSpec | null {
  const { r, factory, walletAddress: w } = p;
  const amt = r["amountRaw"] ? { offset: 0, raw: r["amountRaw"] } : undefined;
  switch (p.type) {
    case "token.distribute": return r["token"] && r["to"] && amt ? { address: factory, keys: [[sel("TokensDistributed")], [norm(r["token"])], [norm(r["to"])]], amount: amt } : null;
    case "token.mint": return r["token"] && amt ? { address: factory, keys: [[sel("TokensMinted")], [norm(r["token"])]], amount: amt } : null;
    case "return": return r["token"] && w && amt ? { address: factory, keys: [[sel("TokensReturned")], [norm(r["token"])], [norm(w)]], amount: amt } : null;
    case "swap": return r["fromToken"] && w && r["amountRaw"] ? { address: factory, keys: [[sel("Swapped")], [norm(w)], [norm(r["fromToken"])]], amount: { offset: 1, raw: r["amountRaw"] } } : null;
    case "transfer": return r["token"] && r["to"] && w && amt ? { address: r["token"], keys: [[sel("Transfer")], [norm(w)], [norm(r["to"])]], amount: amt } : null;
    case "nft.transfer": return r["collection"] && r["to"] && w && r["tokenId"] ? { address: r["collection"], keys: [[sel("Transfer")], [norm(w)], [norm(r["to"])], [norm("0x" + (BigInt(r["tokenId"]) & ((1n << 128n) - 1n)).toString(16))]] } : null;
    case "nft.mint": return r["collection"] && r["to"] ? { address: r["collection"], keys: [[sel("Transfer")], ["0x0"], [norm(r["to"])]] } : null;
    default: return null;
  }
}

type Ev = { transaction_hash: string; block_number?: number; keys: string[]; data: string[] };

/** Does this event's data carry the expected u256 amount? */
export function amountMatches(e: Pick<Ev, "data">, spec: EvidenceSpec) {
  if (!spec.amount) return true;
  const lo = e.data[spec.amount.offset]; const hi = e.data[spec.amount.offset + 1];
  if (lo === undefined || hi === undefined) return false;
  try { return BigInt(lo) + (BigInt(hi) << 128n) === BigInt(spec.amount.raw); } catch { return false; }
}

/**
 * Looks for the first matching event at or after `sinceUnix` that no other hub transaction already owns.
 * Searches only the blocks since then (plus a margin), so it is cheap.
 */
export async function findOnChain(spec: EvidenceSpec, sinceUnix: number, claimed: Set<string>) {
  const latest = await rpcCall<number>("starknet_blockNumber", []);
  const ageSec = Math.max(60, Math.floor(Date.now() / 1000) - sinceUnix);
  const from = Math.max(0, latest - Math.min(60_000, Math.ceil(ageSec / 1.2) + 1_500));
  let token: string | undefined;
  for (let page = 0; page < 6; page++) {
    const res = await rpcCall<{ events: Ev[]; continuation_token?: string }>("starknet_getEvents", {
      filter: { from_block: { block_number: from }, to_block: { block_number: latest }, address: norm(spec.address), keys: spec.keys, chunk_size: 200, ...(token ? { continuation_token: token } : {}) },
    });
    for (const e of res.events) {
      if (!amountMatches(e, spec)) continue;
      if (claimed.has(norm(e.transaction_hash))) continue;
      const t = e.block_number != null ? await blockTime(e.block_number) : null;
      if (t !== null && t < sinceUnix - 120) continue; // older than the request: some other transaction
      return { found: true as const, txHash: e.transaction_hash, block: e.block_number ?? null };
    }
    token = res.continuation_token;
    if (!token) break;
  }
  return { found: false as const };
}

/** How long to keep looking before concluding it did not happen. Longer than any time bound on a signed request. */
export const NOT_ON_CHAIN_AFTER_MINUTES = 60;
