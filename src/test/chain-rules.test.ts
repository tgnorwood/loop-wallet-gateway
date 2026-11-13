import { describe, expect, it } from "vitest";
import {
  canRemoveMinter, capExceeded, fromBaseUnits, idempotencyDecision, kindAllowed, mapChainError, stableJson, swapPairAllowed, toBaseUnits,
} from "@/lib/wallet/chain-rules";
import { addressFromEvents, mintedTokenId } from "@/lib/wallet/core/core";

describe("amounts are decimal strings with 18 decimals", () => {
  it("converts 12.5 to base units and back", () => {
    expect(toBaseUnits("12.5")).toBe(12_500_000_000_000_000_000n);
    expect(fromBaseUnits("12500000000000000000")).toBe("12.5");
  });
  it("rejects JS numbers and too many decimals", () => {
    expect(() => toBaseUnits(5.5 as unknown as string)).toThrow();
    expect(() => toBaseUnits("1.0000000000000000001")).toThrow();
  });
  it("formats the dashboard's 2.5e+21 base units as 2500 tokens", () => {
    expect(fromBaseUnits("2.5e+21")).toBe("2500");
  });
  it("preserves every digit in scientific notation without floating-point rounding", () => {
    expect(fromBaseUnits("2.500000000000000000001e+21")).toBe("2500.000000000000000001");
    expect(fromBaseUnits("2.5E21", 6)).toBe("2500000000000000");
    expect(fromBaseUnits("100e-2", 0)).toBe("1");
  });
  it("rejects fractional base units and unbounded exponents", () => {
    expect(() => fromBaseUnits("2.5e-1")).toThrow("base units must be an integer");
    expect(() => fromBaseUnits("1e1000000")).toThrow("base-unit exponent is out of range");
    expect(() => fromBaseUnits("not an amount")).toThrow();
  });
  it("keeps integer, hex, bigint, zero, and signed amounts working", () => {
    expect(fromBaseUnits("0")).toBe("0");
    expect(fromBaseUnits(12500000000000000000n)).toBe("12.5");
    expect(fromBaseUnits("0xde0b6b3a7640000")).toBe("1");
    expect(fromBaseUnits("-5e17")).toBe("-0.5");
  });
});

describe("idempotency", () => {
  it("same key + same request replays, different request conflicts", () => {
    expect(idempotencyDecision(null, "a")).toBe("new");
    expect(idempotencyDecision({ request_hash: "a" }, "a")).toBe("replay");
    expect(idempotencyDecision({ request_hash: "a" }, "b")).toBe("conflict");
  });
  it("request hash ignores key order", () => {
    expect(stableJson({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(stableJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
  });
});

describe("permissions", () => {
  it("allows all Loop Do token pairs regardless of individual exchange flags", () => {
    for (const from of [false, true]) for (const to of [false, true]) {
      expect(swapPairAllowed("Loop Do", from, to)).toBe(true);
    }
  });
  it("keeps other apps restricted to pairs enabled on both tokens", () => {
    expect(swapPairAllowed("Loop Fans", false, true)).toBe(false);
    expect(swapPairAllowed("PressChain", true, false)).toBe(false);
    expect(swapPairAllowed("Loop Fans", true, true)).toBe(true);
  });
  it("the operator can never be removed as minter", () => {
    expect(canRemoveMinter("0xabc", "0x0abc")).toBe(false);
    expect(canRemoveMinter("0xdef", "0xabc")).toBe(true);
    expect(canRemoveMinter("0xdef", undefined)).toBe(false);
  });
  it("collection owner wallets only do owner actions; user wallets move assets", () => {
    expect(kindAllowed("collection_owner", "collection_owner")).toBe(true);
    expect(kindAllowed("user", "collection_owner")).toBe(false);
    expect(kindAllowed("user", "movement")).toBe(true);
    expect(kindAllowed("collection_owner", "movement")).toBe(false);
  });
  it("daily cap blocks once used + requested passes the cap", () => {
    expect(capExceeded(toBaseUnits("90"), toBaseUnits("10"), 100)).toBe(false);
    expect(capExceeded(toBaseUnits("90"), toBaseUnits("11"), 100)).toBe(true);
    expect(capExceeded(10n ** 30n, 1n, null)).toBe(false);
  });
});

describe("chain error mapping", () => {
  it.each([
    ["Caller is not the owner", "NOT_OWNER", 403],
    ["NFT: metadata frozen", "METADATA_FROZEN", 409],
    ["NFT: caller cannot mint", "NOT_A_MINTER", 409],
    ["ERC20: insufficient balance", "INSUFFICIENT_BALANCE", 422],
    ["ERC721: unauthorized caller", "NOT_OWNER", 403],
  ])("%s → %s", (msg, code, status) => {
    const m = mapChainError(msg);
    expect(m.code).toBe(code);
    expect(m.status).toBe(status);
    expect(m.retry).toBe(false);
  });
  it("network errors are retried", () => {
    expect(mapChainError("fetch failed").retry).toBe(true);
  });
});

describe("reading created addresses from events", () => {
  it("finds the new contract from the factory event and the minted id", () => {
    const factory = "0x066826a54400d0d1485e38c30913ea694c993281aeb4df43b197d9f05375b513";
    expect(addressFromEvents([{ from_address: "0x1", keys: ["0x9", "0x5"] }, { from_address: factory, keys: ["0x9", "0x77"] }], factory)).toBe("0x77");
    expect(mintedTokenId([{ from_address: "0x77", keys: ["0x9", "0x0", "0x5", "0x3", "0x0"] }], "0x77")).toBe("3");
  });
});

import { isGasFreeClass } from "@/lib/wallet/chain-rules";
describe("account class", () => {
  it("only the SNIP-9 class is gas-free; legacy maps to LEGACY_ACCOUNT", () => {
    expect(isGasFreeClass("0x2b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f")).toBe(true);
    expect(isGasFreeClass("0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f")).toBe(false);
    expect(mapChainError("legacy account not available for gas-free execution")).toMatchObject({ code: "LEGACY_ACCOUNT", retry: false });
  });
});
