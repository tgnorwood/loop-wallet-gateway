import { describe, expect, it } from "vitest";
import { describeTx, fmtAmount, type Lookup } from "@/lib/wallet/describe-tx";

const L: Lookup = {
  token: (a) => ({ "0xlib": { symbol: "LIBBALL", name: "Libball" }, "0xyar": { symbol: "YARRA", name: "Yarra" } } as Record<string, { symbol: string; name: string }>)[a],
  collection: (a) => (a === "0xcol" ? { symbol: "FAN", name: "Fan Pass" } : undefined),
  wallet: (x) => ({ w1: "sam@example.com", w2: "ana@example.com", "0xana": "ana@example.com" } as Record<string, string>)[x],
};
const E18 = 10n ** 18n;
const raw = (n: number) => (BigInt(n) * E18).toString();

describe("amounts", () => {
  it("formats base units with grouping", () => { expect(fmtAmount(raw(50))).toBe("50"); expect(fmtAmount(raw(1234567))).toBe("1,234,567"); expect(fmtAmount("1500000000000000000")).toBe("1.5"); });
  it("gives nothing for a missing amount", () => expect(fmtAmount(undefined)).toBeNull());
});

describe("what a transaction did, in words", () => {
  it("transfer: who sent what to whom", () => {
    const d = describeTx({ type: "transfer", wallet_id: "w1", request: { _r: { token: "0xlib", amountRaw: raw(50), to: "0xana", toWalletId: "w2" } } }, L);
    expect(d.summary).toBe("sam@example.com sent 50 LIBBALL to ana@example.com");
    expect(d).toMatchObject({ amount: "50", token: "LIBBALL", from: "sam@example.com", to: "ana@example.com" });
  });
  it("swap: names both tokens", () => {
    const d = describeTx({ type: "swap", wallet_id: "w1", request: { _r: { fromToken: "0xlib", toToken: "0xyar", amountRaw: raw(12) } } }, L);
    expect(d.summary).toBe("sam@example.com swapped 12 LIBBALL for YARRA");
    expect(d).toMatchObject({ token: "LIBBALL", toToken: "YARRA" });
  });
  it("distribute: the operator gives tokens to a wallet it knows by address", () => {
    expect(describeTx({ type: "token.distribute", request: { _r: { token: "0xlib", amountRaw: raw(50), to: "0xana" } } }, L).summary).toBe("Gave 50 LIBBALL to ana@example.com");
  });
  it("unknown token and recipient fall back to short addresses, never blanks", () => {
    const d = describeTx({ type: "token.distribute", request: { _r: { token: "0x1234567890abcdef1234567890abcdef", amountRaw: raw(1), to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }, L);
    expect(d.summary).toBe("Gave 1 0x123456…abcdef to 0xaaaaaa…aaaaaa");
  });
  it("create token and mint", () => {
    expect(describeTx({ type: "token.create", request: { name: "Libball", symbol: "LIBBALL", _r: { amountRaw: raw(1000000) } } }, L).summary).toBe("Created token Libball (LIBBALL) with 1,000,000 supply");
    expect(describeTx({ type: "token.mint", request: { _r: { token: "0xyar", amountRaw: raw(5) } } }, L).summary).toBe("Minted 5 YARRA");
  });
  it("NFTs: mint (with the id once known), transfer, freeze", () => {
    expect(describeTx({ type: "nft.mint", request: { _r: { collection: "0xcol", to: "0xana" } }, result: { tokenId: "7" } }, L).summary).toBe("Minted NFT #7 in Fan Pass to ana@example.com");
    expect(describeTx({ type: "nft.mint", request: { _r: { collection: "0xcol", to: "0xana" } } }, L).summary).toBe("Minted an NFT in Fan Pass to ana@example.com");
    expect(describeTx({ type: "nft.transfer", wallet_id: "w1", request: { tokenId: "7", _r: { collection: "0xcol", to: "0xana" } } }, L).summary).toBe("sam@example.com sent NFT #7 (Fan Pass) to ana@example.com");
    expect(describeTx({ type: "collection.freeze", request: { _r: { collection: "0xcol" } } }, L).summary).toBe("Froze all metadata in Fan Pass");
  });
  it("collections: create with royalties, set royalties", () => {
    expect(describeTx({ type: "collection.create", request: { name: "Fan Pass", symbol: "FAN", _r: { royaltyBps: "250" } } }, L).summary).toBe("Created collection Fan Pass (FAN) with 2.5% royalties");
    expect(describeTx({ type: "collection.royalty", request: { _r: { collection: "0xcol", receiver: "0xana", bps: "500" } } }, L).summary).toBe("Set 5% royalties on Fan Pass to ana@example.com");
  });
  it("an unrecognised type still says something", () => expect(describeTx({ type: "mystery" }, L).summary).toBe("mystery"));
  it("copes with an empty request", () => expect(describeTx({ type: "transfer", request: null }, L).summary).toBe("A wallet sent ? tokens to someone"));
});
