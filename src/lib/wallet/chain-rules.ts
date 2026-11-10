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
  if (m.includes("legacy account")) return { code: "LEGACY_ACCOUNT", status: 409, retry: false };
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

// ---- Loop Do push migration (pure) ----
export const GAS_FREE_CLASS_HASH = "0x02b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f";
export const isGasFreeClass = (classHash: string) => { try { return BigInt(classHash) === BigInt(GAS_FREE_CLASS_HASH); } catch { return false; } };
export const LEGACY_CLASS_MESSAGE = "legacy account not available for gas-free execution";
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const normAddress = (a: string) => "0x" + BigInt(a).toString(16);
/** WALLET_MASTER_KEY: 32 bytes as 64 hex chars (optional 0x) or base64. */
export function parseTransportKey(raw: string): Uint8Array {
  const v = raw.trim();
  const bytes = /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? Uint8Array.from(v.replace(/^0x/, "").match(/.{2}/g)!.map((x) => parseInt(x, 16))) : b64d(v);
  if (bytes.length !== 32) throw new Error("WALLET_MASTER_KEY must be 32 bytes");
  return bytes;
}
/** Decrypt one pushed key (AES-256-GCM, AAD = normalised address). Returns 0x hex private key. */
export async function decryptPushedKey(keyBytes: Uint8Array, address: string, iv: string, ciphertext: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) as BufferSource, additionalData: new TextEncoder().encode(normAddress(address)), tagLength: 128 }, key, b64d(ciphertext) as BufferSource));
  const hex = "0x" + [...pt].map((x) => x.toString(16).padStart(2, "0")).join("");
  pt.fill(0);
  return hex;
}

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
