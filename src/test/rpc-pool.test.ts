import { afterEach, describe, expect, it, vi } from "vitest";
import { isRateLimited, rpcFetch, rpcUrls } from "@/lib/wallet/rpc.server";

afterEach(() => { vi.unstubAllGlobals(); delete process.env["STARKNET_RPC_URL"]; });

describe("RPC failover pool", () => {
  it("recognises the rate-limit messages we have actually seen", () => {
    expect(isRateLimited(200, '{"error":{"message":"cu limit exceeded; Request too fast per second."}}')).toBe(true);
    expect(isRateLimited(429, "")).toBe(true);
    expect(isRateLimited(503, "")).toBe(true);
    expect(isRateLimited(200, '{"result":"0x1"}')).toBe(false);
    expect(isRateLimited(200, '{"error":{"message":"Contract not found"}}')).toBe(false); // a real answer, not a throttle
  });
  it("puts the configured node first and keeps the public ones as fallbacks", () => {
    process.env["STARKNET_RPC_URL"] = "https://paid.example/rpc, https://second.example/rpc";
    const urls = rpcUrls();
    expect(urls[0]).toBe("https://paid.example/rpc");
    expect(urls[1]).toBe("https://second.example/rpc");
    expect(urls.length).toBeGreaterThan(3);
  });
  it("moves to the next node when the first is throttled", async () => {
    process.env["STARKNET_RPC_URL"] = "https://a.example/rpc";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      seen.push(u);
      return u.startsWith("https://a.example")
        ? new Response('{"error":{"message":"Request too fast per second"}}', { status: 200 })
        : new Response('{"result":123}', { status: 200 });
    });
    const res = await rpcFetch('{"jsonrpc":"2.0","id":1,"method":"starknet_blockNumber","params":[]}');
    expect(((await res.json()) as { result: number }).result).toBe(123);
    expect(seen[0]).toBe("https://a.example/rpc");
    expect(seen.length).toBeGreaterThan(1);
  });
});
