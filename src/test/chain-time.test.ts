import { afterEach, describe, expect, it, vi } from "vitest";
import { blockTimes, dayOf } from "@/lib/wallet/chain-time.server";

afterEach(() => { vi.unstubAllGlobals(); });

describe("real dates from block times", () => {
  it("turns a unix time into a UTC day", () => {
    expect(dayOf(1794255490)).toBe("2026-11-09");
    expect(dayOf(1792707085)).toBe("2026-10-22");
  });
  it("asks the chain once per block and remembers the answer", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      calls++;
      const n = (JSON.parse(init.body) as { params: { block_id: { block_number: number } } }).params.block_id.block_number;
      return new Response(JSON.stringify({ result: { timestamp: 1_790_000_000 + n } }), { status: 200 });
    });
    const first = await blockTimes([9001, 9002, 9001]);
    expect(first.get(9001)).toBe(1_790_009_001);
    expect(first.get(9002)).toBe(1_790_009_002);
    expect(calls).toBe(2);
    await blockTimes([9001, 9002]);
    expect(calls).toBe(2); // second time comes from memory
  });
  it("skips blocks it could not read instead of guessing", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":{"message":"Block not found"}}', { status: 200 }));
    const out = await blockTimes([777_777_777]);
    expect(out.has(777_777_777)).toBe(false);
  });
});

import { interpolateTime } from "@/lib/wallet/chain-time.server";
describe("estimating a block's time between two known blocks", () => {
  const known: Record<number, number> = { 17_000_000: 1_000_000, 17_010_000: 1_001_000 };
  const anchor = (b: number) => known[b];
  it("is exact on an anchor", () => expect(interpolateTime(17_000_000, 10_000, anchor)).toBe(1_000_000));
  it("lands proportionally in between", () => expect(interpolateTime(17_005_000, 10_000, anchor)).toBe(1_000_500));
  it("falls back to the earlier anchor when the later one is unknown", () => expect(interpolateTime(17_015_000, 10_000, (b) => (b === 17_010_000 ? 1_001_000 : undefined))).toBe(1_001_000));
  it("gives nothing when neither anchor is known", () => expect(interpolateTime(1, 10_000, () => undefined)).toBeUndefined());
});
