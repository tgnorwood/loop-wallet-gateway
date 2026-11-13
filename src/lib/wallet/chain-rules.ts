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
  // JSON numeric columns can arrive as exponent strings (e.g. "2.5e+21").
  // Expand with integer arithmetic, never Number(), to preserve every digit.
  let v: bigint;
  const scientific = typeof raw === "string" ? /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw.trim()) : null;
  if (scientific) {
    const [, sign, whole = "0", fraction = "", exponent = "0"] = scientific;
    const shift = BigInt(exponent) - BigInt(fraction.length);
    if (shift > 1000n || shift < -1000n) throw new Error("base-unit exponent is out of range");
    const digits = BigInt(whole + fraction);
    if (shift >= 0n) v = digits * 10n ** shift;
    else {
      const divisor = 10n ** -shift;
      if (digits % divisor !== 0n) throw new Error("base units must be an integer");
      v = digits / divisor;
    }
    if (sign === "-") v = -v;
  } else v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const magnitude = v < 0n ? -v : v;
  const frac = (magnitude % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v < 0n ? "-" : ""}${magnitude / base}${frac ? "." + frac : ""}`;
}

export const signerKeyOperator = (network: string) => `operator:${network}`;
export const signerKeyWallet = (walletId: string) => `wallet:${walletId}`;

/** Loop Do may request any of its token pairs; other apps opt in per token. */
export function swapPairAllowed(appName: string, fromSwappable: boolean, toSwappable: boolean) {
  return appName.trim().toLowerCase() === "loop do" || (fromSwappable && toSwappable);
}

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
  if (m.includes("legacy account")) return { code: "LEGACY_ACCOUNT", status: 409, retry: false };
  if (m.includes("not configured") || m.includes("not available")) return { code: "CONFIG_ERROR", status: 503, retry: false };
  return { code: "CHAIN_ERROR", status: 502, retry: true };
}

export const MAX_RETRIES = 3;
export const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 15 * 60_000);
/** Webhook retries: exponential, give up after 24h. */
export const webhookBackoffMs = (attempt: number) => Math.min(30_000 * 2 ** attempt, 6 * 3600_000);
export const WEBHOOK_MAX_AGE_MS = 24 * 3600_000;

/** A lost submission reply is not evidence of failure and must never be retried blindly. */
export function submissionNeedsReconciliation(code: string | undefined, retryable: boolean) {
  return code === "SUBMISSION_UNKNOWN" || retryable;
}

export function publicTransactionStatus(status: string, errorCode: string | null) {
  if ((status === "processing" || status === "submitted") && errorCode === "SUBMISSION_UNKNOWN") return "unknown";
  if (status === "unknown") return "unknown";
  if (status === "finalizing") return "submitted";
  return status === "processing" ? "queued" : status;
}

export function capExceeded(usedRaw: bigint, requestRaw: bigint, capHuman: string | number | null | undefined) {
  if (capHuman === null || capHuman === undefined || capHuman === "") return false;
  return usedRaw + requestRaw > toBaseUnits(String(capHuman));
}

// ---- Loop Do push migration (pure) ----
export const GAS_FREE_CLASS_HASH = "0x02b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f";
export const isGasFreeClass = (classHash: string) => { try { return BigInt(classHash) === BigInt(GAS_FREE_CLASS_HASH); } catch { return false; } };
export const LEGACY_CLASS_MESSAGE = "legacy account not available for gas-free execution";
// ---- Chain history import ----
const pad64 = (h: string) => "0x" + BigInt(h).toString(16).padStart(64, "0");
export type TransferEvt = { tx_hash: string; ordinal: number; block_number: number; from_address: string; to_address: string; amount: string };
/** Parse ERC-20 Transfer events (Cairo 1: keys=[sel,from,to] data=[lo,hi]; Cairo 0: keys=[sel] data=[from,to,lo,hi]). Ordinal = position within its tx, for dedupe. */
export function parseTransferEvents(events: { transaction_hash: string; block_number?: number; keys: string[]; data: string[] }[]): TransferEvt[] {
  const seen = new Map<string, number>(); const out: TransferEvt[] = [];
  for (const e of events) {
    let f: string, t: string, lo: string, hi: string;
    if (e.keys.length >= 3 && e.data.length >= 2) [f, t, lo, hi] = [e.keys[1]!, e.keys[2]!, e.data[0]!, e.data[1]!];
    else if (e.data.length >= 4) [f, t, lo, hi] = [e.data[0]!, e.data[1]!, e.data[2]!, e.data[3]!];
    else continue;
    const n = seen.get(e.transaction_hash) ?? 0; seen.set(e.transaction_hash, n + 1);
    out.push({ tx_hash: pad64(e.transaction_hash), ordinal: n, block_number: e.block_number ?? 0, from_address: pad64(f), to_address: pad64(t), amount: (BigInt(lo) + (BigInt(hi) << 128n)).toString() });
  }
  return out;
}
/** Holder balances from transfers (zero address excluded, empty balances dropped). */
export function balancesFromTransfers(evts: Pick<TransferEvt, "from_address" | "to_address" | "amount">[]): Map<string, bigint> {
  const zero = pad64("0x0"); const m = new Map<string, bigint>();
  for (const e of evts) {
    const a = BigInt(e.amount);
    if (e.to_address !== zero) m.set(e.to_address, (m.get(e.to_address) ?? 0n) + a);
    if (e.from_address !== zero) m.set(e.from_address, (m.get(e.from_address) ?? 0n) - a);
  }
  for (const [k, v] of m) if (v <= 0n) m.delete(k);
  return m;
}


// ---- Recovering a request whose reply was lost ----
export type RelayLookup = { found: boolean; status?: string; transactionHash?: string | null; error?: string | null; definite?: boolean; ageSeconds?: number; trackingSince?: string };
export type ReconcileDecision =
  | { action: "attach"; txHash: string }
  | { action: "fail"; message: string }
  | { action: "requeue" }
  | { action: "wait"; reason: string };

/**
 * What to do with an operator transaction whose outcome we lost, given what the relay's request log says.
 * Only ever resends when the relay proves it never started the request; otherwise it follows the real transaction.
 */
export function reconcileDecision(p: { createdAt: string; attempts: number; lookup: RelayLookup }): ReconcileDecision {
  const l = p.lookup;
  if (l.found) {
    if (l.status === "submitted" && l.transactionHash) return { action: "attach", txHash: l.transactionHash };
    if (l.status === "failed") return { action: "fail", message: l.error ?? "rejected before it was sent" };
    return { action: "wait", reason: "the relay is still working on it or did not finish recording it" };
  }
  // Not in the relay's log. That only proves "never sent" for requests made after the log existed.
  if (!l.trackingSince || Date.parse(p.createdAt) < Date.parse(l.trackingSince)) return { action: "wait", reason: "sent before request tracking existed; check the chain" };
  if (p.attempts >= MAX_RETRIES) return { action: "wait", reason: "retried several times already" };
  return { action: "requeue" };
}
