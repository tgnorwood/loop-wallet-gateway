// Pure rules for the central wallet API (no DB, no network) so they can be unit-tested.

export function toBaseUnits(value: unknown, decimals = 18): bigint {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`amount must be a decimal string like "12.5"`);
  }
  const [whole, frac = ""] = value.split(".");
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function fromBaseUnits(raw: string | bigint, decimals = 18) {
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? "." + frac : ""}`;
}

export const signerKeyOperator = (network: string) => `operator:${network}`;
export const signerKeyWallet = (walletId: string) => `wallet:${walletId}`;

/** Stable JSON so the same request always hashes the same for idempotency checks. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + stableJson((v as Record<string, unknown>)[k])).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type IdemDecision = "new" | "replay" | "conflict";
export function idempotencyDecision(existing: { request_hash: string } | null, requestHash: string): IdemDecision {
  if (!existing) return "new";
  return existing.request_hash === requestHash ? "replay" : "conflict";
}

export type WalletKind = "user" | "collection_owner" | "treasury";
export function kindAllowed(kind: string, action: "movement" | "collection_owner") {
  if (action === "collection_owner") return kind === "collection_owner";
  return kind === "user" || kind === "treasury";
}

export const sameAddress = (a?: string | null, b?: string | null) => {
  if (!a || !b) return false;
  try { return BigInt(a) === BigInt(b); } catch { return false; }
};

/** The API must never let a collection owner remove the operator as minter. Unknown operator → refuse all removals. */
export function canRemoveMinter(target: string, operatorAddress: string | null | undefined) {
  if (!operatorAddress) return false;
  return !sameAddress(target, operatorAddress);
}

/** Map contract / paymaster messages to the brief's API error codes. */
export function mapChainError(message: string, type?: string): { code: string; status: number; retry: boolean } {
  const m = message.toLowerCase();
  if (m.includes("caller is not the owner")) return { code: "NOT_OWNER", status: 403, retry: false };
  if (m.includes("metadata frozen")) return { code: "METADATA_FROZEN", status: 409, retry: false };
  if (m.includes("caller cannot mint")) return { code: "NOT_A_MINTER", status: 409, retry: false };
  if (m.includes("insufficient balance")) return { code: type === "swap" ? "INSUFFICIENT_BALANCE_OR_LIQUIDITY" : "INSUFFICIENT_BALANCE", status: 422, retry: false };
  if (m.includes("unauthorized caller")) return { code: "NOT_OWNER", status: 403, retry: false };
  if (m.includes("unknown token")) return { code: "VALIDATION", status: 400, retry: false };
  if (m.includes("same token")) return { code: "VALIDATION", status: 400, retry: false };
  if (m.includes("reverted")) return { code: "REVERTED", status: 422, retry: false };
  if (m.includes("not configured") || m.includes("not available")) return { code: "CONFIG_ERROR", status: 503, retry: false };
  return { code: "CHAIN_ERROR", status: 502, retry: true };
}

export const MAX_RETRIES = 3;
export const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 15 * 60_000);
/** Webhook retries: exponential, give up after 24h. */
export const webhookBackoffMs = (attempt: number) => Math.min(30_000 * 2 ** attempt, 6 * 3600_000);
export const WEBHOOK_MAX_AGE_MS = 24 * 3600_000;

export function capExceeded(usedRaw: bigint, requestRaw: bigint, capHuman: string | number | null | undefined) {
  if (capHuman === null || capHuman === undefined || capHuman === "") return false;
  return usedRaw + requestRaw > toBaseUnits(String(capHuman));
}
