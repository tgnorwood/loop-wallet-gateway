import { describe, expect, it } from "vitest";
import { balancesFromTransfers, parseTransferEvents } from "@/lib/wallet/chain-rules";

describe("Loop Do token history import", () => {
  it("reads Cairo 1 transfers (from/to in keys) with u256 amounts", () => {
    const [e] = parseTransferEvents([{ transaction_hash: "0xabc", block_number: 5, keys: ["0x99", "0x0", "0x1"], data: ["0x10", "0x1"] }]);
    expect(e!.from_address).toBe("0x" + "0".repeat(64));
    expect(e!.amount).toBe((16n + (1n << 128n)).toString());
  });
  it("reads Cairo 0 transfers (from/to in data)", () => {
    const [e] = parseTransferEvents([{ transaction_hash: "0xabc", keys: ["0x99"], data: ["0x2", "0x3", "0x5", "0x0"] }]);
    expect(e!.to_address.endsWith("3")).toBe(true);
    expect(e!.amount).toBe("5");
  });
  it("numbers two transfers in the same tx so neither is dropped as a duplicate", () => {
    const evts = parseTransferEvents([
      { transaction_hash: "0x1", keys: ["0x9", "0x0", "0xa"], data: ["0x1", "0x0"] },
      { transaction_hash: "0x1", keys: ["0x9", "0x0", "0xb"], data: ["0x1", "0x0"] },
    ]);
    expect(evts.map((e) => e.ordinal)).toEqual([0, 1]);
  });
  it("mint 10 to A, A sends 4 to B → A 6, B 4, zero address not a holder", () => {
    const z = "0x" + "0".repeat(64), a = "0x" + "a".padStart(64, "0"), b = "0x" + "b".padStart(64, "0");
    const m = balancesFromTransfers([{ from_address: z, to_address: a, amount: "10" }, { from_address: a, to_address: b, amount: "4" }]);
    expect(m.get(a)).toBe(6n); expect(m.get(b)).toBe(4n); expect(m.has(z)).toBe(false);
  });
});
