// Starknet RPC with failover. A single free node rate-limits ("cu limit exceeded", "Request too fast")
// as soon as several things read the chain at once, so every read goes through this pool: it tries the
// configured node first, remembers which nodes are cooling down, retries with a short pause, and
// moves on to the next node. Put a paid node first with STARKNET_RPC_URL (comma-separated list allowed).
const FALLBACKS = [
  "https://api.zan.top/public/starknet-sepolia",
  "https://starknet-sepolia-rpc.publicnode.com",
  "https://starknet-sepolia.drpc.org",
];

export function rpcUrls(): string[] {
  const env = (process.env["STARKNET_RPC_URL"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...env, ...FALLBACKS.filter((f) => !env.includes(f))];
}

/** First node, for code that needs a single URL. */
export const rpcUrl = () => rpcUrls()[0]!;

const COOLING = /too fast|rate.?limit|cu limit|too many|exceeded|capacity|throttl|unavailable/i;
const coolUntil = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when a JSON-RPC body says "slow down / try elsewhere" rather than a real answer. */
export function isRateLimited(status: number, body: string) {
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  if (!body.includes("error")) return false;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    return !!j.error?.message && COOLING.test(j.error.message);
  } catch { return false; }
}

/** POSTs a JSON-RPC body to the first node that answers properly. Returns the raw Response. */
export async function rpcFetch(body: string, init: RequestInit = {}): Promise<Response> {
  const urls = rpcUrls();
  let last: Response | null = null;
  let lastErr: unknown = null;
  for (let round = 0; round < 3; round++) {
    for (const u of urls) {
      if ((coolUntil.get(u) ?? 0) > Date.now() && round === 0) continue;
      try {
        const res = await fetch(u, { ...init, method: "POST", headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) }, body, signal: AbortSignal.timeout(15_000) });
        const text = await res.clone().text();
        if (!isRateLimited(res.status, text)) return res;
        coolUntil.set(u, Date.now() + 2_000 * (round + 1));
        last = res;
      } catch (e) { lastErr = e; coolUntil.set(u, Date.now() + 3_000); }
    }
    await sleep(250 * (round + 1) + Math.random() * 200);
  }
  if (last) return last;
  throw lastErr instanceof Error ? lastErr : new Error("All Starknet RPC nodes failed");
}

/** Drop-in `fetch` for starknet.js (RpcProvider baseFetch): ignores the URL it is given and uses the pool. */
export const pooledFetch: typeof fetch = async (_input, init) => rpcFetch(String(init?.body ?? ""));

/** Convenience JSON-RPC call. */
export async function rpcCall<T>(method: string, params: unknown): Promise<T> {
  const res = await rpcFetch(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}
