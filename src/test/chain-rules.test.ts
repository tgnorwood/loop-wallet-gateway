import { describe, expect, it } from "vitest";
import {
  canRemoveMinter, capExceeded, fromBaseUnits, idempotencyDecision, kindAllowed, mapChainError, stableJson, toBaseUnits,
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

import { parseTransportKey, decryptPushedKey, isGasFreeClass, normAddress } from "@/lib/wallet/chain-rules";
describe("Loop Do push migration", () => {
  const keyHex = "11".repeat(32);
  const addr = "0x0" + "abc".repeat(10);
  async function encrypt(plain: Uint8Array, aadAddr: string) {
    const k = await crypto.subtle.importKey("raw", parseTransportKey(keyHex) as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = new Uint8Array(12).fill(7);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(normAddress(aadAddr)), tagLength: 128 }, k, plain as BufferSource));
    return { iv: btoa(String.fromCharCode(...iv)), ciphertext: btoa(String.fromCharCode(...ct)) };
  }
  it("accepts 64-hex and base64 32-byte keys, rejects others", () => {
    expect(parseTransportKey(keyHex).length).toBe(32);
    expect(parseTransportKey(btoa(String.fromCharCode(...new Uint8Array(32)))).length).toBe(32);
    expect(() => parseTransportKey("abcd")).toThrow();
  });
  it("decrypts a key bound to its address", async () => {
    const e = await encrypt(new Uint8Array(32).fill(1), addr);
    expect(await decryptPushedKey(parseTransportKey(keyHex), addr, e.iv, e.ciphertext)).toBe("0x" + "01".repeat(32));
  });
  it("refuses a key sent with a different address", async () => {
    const e = await encrypt(new Uint8Array(32).fill(1), addr);
    await expect(decryptPushedKey(parseTransportKey(keyHex), "0x1234", e.iv, e.ciphertext)).rejects.toThrow();
  });
  it("only the SNIP-9 class is gas-free; legacy maps to LEGACY_ACCOUNT", () => {
    expect(isGasFreeClass("0x2b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f")).toBe(true);
    expect(isGasFreeClass("0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f")).toBe(false);
    expect(mapChainError("legacy account not available for gas-free execution")).toMatchObject({ code: "LEGACY_ACCOUNT", retry: false });
  });
});
