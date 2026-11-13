import { afterEach, describe, expect, it, vi } from "vitest";
import { amountMatches, evidenceSpec, findOnChain } from "@/lib/wallet/chain-evidence.server";

afterEach(() => { vi.unstubAllGlobals(); });
const FACTORY = "0x043ec989c90cbddd5a24ce9eab4e2ed59f8294236c351511338762734dc5551c";
const TOKEN = "0x6dda1c4e7cf92b0156adecf2c8e66e7305cded9e0dc8dd99276d15ccb0d5fb";
const TO = "0x33e720fef988ca2b78795dc38e5c08533250c893a8f2d31454337099c3b1897";
const WALLET = "0x042ae5cc0000000000000000000000000000000000000000000000000000a40f5";
const FIFTY = "50000000000000000000";
const base = { factory: FACTORY, walletAddress: WALLET };

describe("what proves a request happened", () => {
  it("distribute: the factory's TokensDistributed event for that token and recipient", () => {
    const s = evidenceSpec({ ...base, type: "token.distribute", r: { token: TOKEN, to: TO, amountRaw: FIFTY } })!;
    expect(s.address).toBe(FACTORY);
    expect(s.keys).toHaveLength(3);
    expect(s.keys[1]).toEqual([TOKEN]); expect(s.keys[2]).toEqual([TO]);
    expect(s.amount).toEqual({ offset: 0, raw: FIFTY });
  });
  it("transfer: the token's own Transfer event from the user's wallet", () => {
    const s = evidenceSpec({ ...base, type: "transfer", r: { token: TOKEN, to: TO, amountRaw: FIFTY } })!;
    expect(s.address).toBe(TOKEN); expect(s.keys[1]).toEqual(["0x" + BigInt(WALLET).toString(16)]); expect(s.keys[2]).toEqual([TO]);
  });
  it("swap: amount is read after the token_to field", () => {
    expect(evidenceSpec({ ...base, type: "swap", r: { fromToken: TOKEN, toToken: "0x9", amountRaw: FIFTY } })!.amount).toEqual({ offset: 1, raw: FIFTY });
  });
  it("kinds it cannot match say so instead of guessing", () => {
    for (const type of ["token.create", "collection.create", "nft.update", "collection.freeze"]) expect(evidenceSpec({ ...base, type, r: {} })).toBeNull();
  });
  it("needs the wallet address for wallet-signed kinds", () => {
    expect(evidenceSpec({ factory: FACTORY, walletAddress: null, type: "transfer", r: { token: TOKEN, to: TO, amountRaw: FIFTY } })).toBeNull();
  });
});

describe("amount matching", () => {
  const spec = { address: FACTORY, keys: [], amount: { offset: 0, raw: FIFTY } };
  it("matches the exact u256", () => expect(amountMatches({ data: ["0x2b5e3af16b1880000", "0x0"] }, spec)).toBe(true));
  it("rejects a different amount", () => expect(amountMatches({ data: ["0x2b5e3af16b1880001", "0x0"] }, spec)).toBe(false));
  it("rejects missing data", () => expect(amountMatches({ data: [] }, spec)).toBe(false));
});

describe("searching the chain", () => {
  const spec = evidenceSpec({ ...base, type: "token.distribute", r: { token: TOKEN, to: TO, amountRaw: FIFTY } })!;
  const since = 1_794_255_000;
  const ev = (hash: string, block: number) => ({ transaction_hash: hash, block_number: block, keys: [], data: ["0x2b5e3af16b1880000", "0x0"] });
  function chain(events: ReturnType<typeof ev>[], blockTimes: Record<number, number>) {
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      const j = JSON.parse(init.body) as { method: string; params: { block_id?: { block_number: number } } };
      const result = j.method === "starknet_blockNumber" ? 18_056_500
        : j.method === "starknet_getEvents" ? { events }
        : { timestamp: blockTimes[j.params.block_id!.block_number] ?? since };
      return new Response(JSON.stringify({ result }), { status: 200 });
    });
  }
  it("finds the matching transaction", async () => {
    chain([ev("0xaaa", 18_056_324)], { 18_056_324: since + 60 });
    expect(await findOnChain(spec, since, new Set())).toEqual({ found: true, txHash: "0xaaa", block: 18_056_324 });
  });
  it("does not claim a transaction another request already owns", async () => {
    chain([ev("0xaaa", 18_056_324)], { 18_056_324: since + 60 });
    expect((await findOnChain(spec, since, new Set(["0xaaa"]))).found).toBe(false);
  });
  it("takes the next unclaimed one when an identical earlier transaction belongs to someone else", async () => {
    chain([ev("0xaaa", 18_056_324), ev("0xbbb", 18_056_330)], { 18_056_324: since + 60, 18_056_330: since + 70 });
    expect(await findOnChain(spec, since, new Set(["0xaaa"]))).toMatchObject({ found: true, txHash: "0xbbb" });
  });
  it("ignores a matching event from BEFORE the request existed", async () => {
    chain([ev("0x01d", 18_000_000)], { 18_000_000: since - 3600 });
    expect((await findOnChain(spec, since, new Set())).found).toBe(false);
  });
  it("finds nothing when nothing matches", async () => {
    chain([], {});
    expect((await findOnChain(spec, since, new Set())).found).toBe(false);
  });
});
