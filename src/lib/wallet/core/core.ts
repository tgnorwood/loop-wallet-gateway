// TypeScript port of the Token Factory reference wallet-core.mjs (verified on Sepolia).
// Server-only usage: the relay key and decrypted private keys are passed in, never stored here.
import { Account, Contract, PaymasterRpc, RpcProvider, num } from "starknet";
import tokenFactoryAbi from "./abis/TokenFactory";
import tokenAbi from "./abis/MintableToken";
import nftFactoryAbi from "./abis/NftCollectionFactory";
import nftAbi from "./abis/MetadataNft";
import { ACCOUNT_CLASS_HASH } from "../starknet";
import { pooledFetch } from "../rpc.server";

export const BASE_URL = "https://token-factory-console.pages.dev";

export type Network = "sepolia" | "mainnet";
type NetCfg = { rpc: string; paymaster: string; accountClassHash: string; tokenFactory: string; nftFactory: string; explorer: string };

// Mainnet stays empty until contracts are deployed there (see the brief's mainnet checklist).
export const NETWORKS: Partial<Record<Network, NetCfg>> = {
  sepolia: {
    rpc: "https://api.zan.top/public/starknet-sepolia",
    paymaster: `${BASE_URL}/api/paymaster/sepolia`,
    accountClassHash: ACCOUNT_CLASS_HASH,
    tokenFactory: "0x043ec989c90cbddd5a24ce9eab4e2ed59f8294236c351511338762734dc5551c",
    nftFactory: "0x066826a54400d0d1485e38c30913ea694c993281aeb4df43b197d9f05375b513",
    explorer: "https://sepolia.voyager.online",
  },
};

export function cfg(network: string): NetCfg {
  const c = NETWORKS[network as Network];
  if (!c) throw Object.assign(new Error(`network ${network} is not available`), { code: "NETWORK_DISABLED" });
  const rpc = process.env["STARKNET_RPC_URL"];
  const pm = process.env["PAYMASTER_URL"];
  return { ...c, rpc: network === "sepolia" && rpc ? rpc : c.rpc, paymaster: network === "sepolia" && pm ? pm : c.paymaster };
}

/** Strings to contracts must be bytes, never plain strings (a "7" would be stored as the number 7). */
export const text = (s: unknown) => new TextEncoder().encode(String(s));

// Reads go through the failover pool (rpc.server.ts) so one rate-limited node does not break balances, receipts or syncing.
export const provider = (network: string) => new RpcProvider({ nodeUrl: cfg(network).rpc, ...(network === "sepolia" ? { baseFetch: pooledFetch } : {}) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;
const C = (abi: unknown, address: string, network: string): AnyContract =>
  new Contract({ abi: abi as never, address, providerOrAccount: provider(network) });

export type Signer = { address: string; publicKey: string; privateKey: string; classHash?: string | null };
export type Call = { contractAddress: string; entrypoint: string; calldata: unknown };

export async function isDeployed(network: string, address: string) {
  try {
    await provider(network).getClassHashAt(address);
    return true;
  } catch (err) {
    if (String((err as Error)?.message ?? err).includes("Contract not found")) return false;
    throw err;
  }
}

/** Sign + send calls from a custodial wallet, gas sponsored; deploys the account in its first tx. */
export async function send(network: string, wallet: Signer, calls: Call[]) {
  const c = cfg(network);
  const paymasterHeaders: Record<string, string> = {};
  const pmKey = process.env["PAYMASTER_API_KEY"];
  if (pmKey) paymasterHeaders["x-paymaster-api-key"] = pmKey;
  const account = new Account({
    provider: provider(network),
    address: wallet.address,
    signer: wallet.privateKey,
    paymaster: new PaymasterRpc({ nodeUrl: c.paymaster, headers: paymasterHeaders }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const details: any = { feeMode: { mode: "sponsored" } };
  if (!(await isDeployed(network, wallet.address))) {
    details.deploymentData = {
      address: wallet.address,
      class_hash: wallet.classHash ?? c.accountClassHash,
      salt: wallet.publicKey,
      calldata: [wallet.publicKey],
      version: 1,
    };
  }
  try {
    const tx = await account.executePaymasterTransaction(calls as never, details);
    return { transactionHash: tx.transaction_hash, deployedNow: !!details.deploymentData };
  } catch (err) {
    throw readableError(err);
  }
}

export function readableError(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  const reasons = [...msg.matchAll(/\('([^']{3,100})'\)/g)].map((m) => m[1]);
  if (reasons.length) return Object.assign(new Error(reasons[reasons.length - 1]), { code: "REVERTED" });
  return err instanceof Error ? err : new Error(msg);
}

/** Non-blocking receipt check. null = still pending. */
export async function receiptStatus(network: string, txHash: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await provider(network).getTransactionReceipt(txHash);
    const raw = r?.value ?? r;
    const exec = String(raw?.execution_status ?? "").toUpperCase();
    const fin = String(raw?.finality_status ?? "").toUpperCase();
    if (exec.includes("REVERT")) return { state: "reverted" as const, reason: String(raw?.revert_reason ?? "reverted"), events: raw?.events ?? [] };
    if (exec === "SUCCEEDED" || fin.includes("ACCEPTED")) return { state: "ok" as const, events: (raw?.events ?? []) as { from_address: string; keys: string[]; data: string[] }[] };
    return null;
  } catch {
    return null;
  }
}

export function builders(network: string) {
  const c = cfg(network);
  const factory = C(tokenFactoryAbi, c.tokenFactory, network);
  const token = (a: string) => C(tokenAbi, a, network);
  const nft = (a: string) => C(nftAbi, a, network);
  return {
    transferToken: (t: string, to: string, amount: bigint): Call[] => [token(t).populate("transfer", [to, amount])],
    returnTokens: (t: string, amount: bigint): Call[] => [
      token(t).populate("approve", [c.tokenFactory, amount]),
      factory.populate("return_tokens", [t, amount]),
    ],
    swap: (from: string, to: string, amount: bigint): Call[] => [
      token(from).populate("approve", [c.tokenFactory, amount]),
      factory.populate("swap", [from, to, amount]),
    ],
    transferNft: (col: string, from: string, to: string, id: bigint): Call[] => [nft(col).populate("transfer_from", [from, to, id])],
    setTokenUri: (col: string, id: bigint, uri: string): Call[] => [nft(col).populate("set_token_uri", [id, text(uri)])],
    setAttributes: (col: string, id: bigint, attrs: { key: string; value: unknown }[]): Call[] => [
      nft(col).populate("set_attributes", [id, attrs.map((a) => ({ key: text(a.key), value: text(a.value) }))]),
    ],
    setMedia: (col: string, id: bigint, media: { role?: string; uri: string; mimeType?: string; contentHash?: string }[]): Call[] => [
      nft(col).populate("set_media", [
        id,
        media.map((m) => ({ role: text(m.role ?? ""), uri: text(m.uri), mime_type: text(m.mimeType ?? ""), content_hash: BigInt(m.contentHash ?? 0) })),
      ]),
    ],
    freezeToken: (col: string, id: bigint): Call[] => [nft(col).populate("freeze_token_metadata", [id])],
    freezeCollection: (col: string): Call[] => [nft(col).populate("freeze_collection_metadata", [])],
    setRoyalty: (col: string, receiver: string, bps: number): Call[] => [nft(col).populate("set_default_royalty", [receiver, BigInt(bps)])],
    addMinter: (col: string, m: string): Call[] => [nft(col).populate("add_minter", [m])],
    removeMinter: (col: string, m: string): Call[] => [nft(col).populate("remove_minter", [m])],
  };
}

export function readers(network: string) {
  const c = cfg(network);
  return {
    tokenBalance: async (t: string, owner: string) => BigInt(await C(tokenAbi, t, network).balance_of(owner)).toString(),
    nftOwner: async (col: string, id: bigint) => num.toHex(await C(nftAbi, col, network).owner_of(id)),
    nftFrozen: async (col: string, id: bigint) => Boolean(await C(nftAbi, col, network).is_metadata_frozen(id)),
    totalMinted: async (col: string) => BigInt(await C(nftAbi, col, network).total_minted()).toString(),
    tokenSupply: async (t: string) => BigInt(await C(tokenAbi, t, network).total_supply()).toString(),
    factoryBalance: async (t: string) => BigInt(await C(tokenAbi, t, network).balance_of(c.tokenFactory)).toString(),
  };
}

/** Operator actions go through the Token Factory relay (one at a time, shared operator nonce). */
export async function relay(network: string, action: string, body: Record<string, unknown>, requestId?: string) {
  const key = process.env["RELAY_API_KEY"];
  if (!key) throw Object.assign(new Error("RELAY_API_KEY is not configured"), { code: "RELAY_NOT_CONFIGURED" });
  const c = cfg(network);
  const full: Record<string, unknown> = { network, sponsorGas: true, ...body, wait: false, ...(requestId ? { requestId } : {}) };
  if (action.startsWith("nft/create-collection")) full["factoryAddress"] = c.nftFactory;
  else if (!action.startsWith("nft/")) full["factoryAddress"] = c.tokenFactory;
  const started = Date.now();
  // Only response/error bodies are logged, never outbound headers or signing keys.
  const safe = (value: string) => value.split(key).join("[REDACTED]").replace(/("(?:[^"\\]*(?:secret|private_key|privateKey|api_key|apiKey|authorization)[^"\\]*)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"').slice(0, 12000);
  try {
  const res = await fetch(`${BASE_URL}/api/relay/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-relay-api-key": key },
    body: JSON.stringify(full),
    signal: AbortSignal.timeout(20_000),
  });
  const txt = await res.text();
  console.info("relay_response", { requestId, action, httpStatus: res.status, elapsedMs: Date.now() - started, body: safe(txt) });
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(txt); } catch { /* non-JSON */ }
  if (!res.ok || !data["ok"]) {
    const e = Object.assign(new Error(String(data["error"] ?? `relay ${action} failed (${res.status})`)), { status: res.status });
    // The relay says plainly that nothing was sent: safe to try again, which the recovery pass does.
    if (data["notSent"] === true || data["inProgress"] === true) throw Object.assign(e, { code: "SUBMISSION_UNKNOWN" });
    if (res.status >= 500 || res.ok && !data["ok"]) throw Object.assign(e, { code: "SUBMISSION_UNKNOWN" });
    // 4xx: the relay refused it before sending anything. A definite failure, not an unknown.
    const re = readableError(e);
    throw Object.assign(re, { code: (re as { code?: string }).code ?? "REJECTED" });
  }
  const txHash = data["transactionHash"] ?? data["txHash"] ?? data["transaction_hash"];
  if (typeof txHash !== "string" || !/^0x[0-9a-f]+$/i.test(txHash)) throw Object.assign(new Error("Relay reply has no valid transaction hash; check the chain before retrying"), { code: "SUBMISSION_UNKNOWN" });
  data["transactionHash"] = txHash;
  return data;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("relay_error", { requestId, action, elapsedMs: Date.now() - started, name: e.name, message: safe(e.message), code: (e as { code?: string }).code ?? null });
    const originalName = err && typeof err === "object" && "name" in err ? String(err.name) : e.name;
    if (originalName === "TimeoutError" || originalName === "AbortError" || e instanceof TypeError) throw Object.assign(e, { code: "SUBMISSION_UNKNOWN" });
    throw e;
  }
}

/** Pull a created address out of a factory event: keys[0]=selector, keys[1]=new contract. */
export function addressFromEvents(events: { from_address: string; keys: string[] }[], factory: string) {
  for (const ev of events) {
    if (ev?.from_address && BigInt(ev.from_address) === BigInt(factory) && ev.keys?.[1] && BigInt(ev.keys[1]) !== 0n) return ev.keys[1];
  }
  return null;
}

/** ERC721 Transfer(from=0) mint event: keys [sel, from, to, id.low, id.high]. */
export function mintedTokenId(events: { from_address: string; keys: string[] }[], collection: string) {
  for (const ev of events) {
    if (ev?.from_address && BigInt(ev.from_address) === BigInt(collection) && ev.keys?.length >= 5 && BigInt(ev.keys[1]!) === 0n) {
      return (BigInt(ev.keys[3]!) + (BigInt(ev.keys[4]!) << 128n)).toString();
    }
  }
  return null;
}

/** Asks the relay what became of an earlier request (by the requestId we sent). */
export async function relayLookup(_network: string, requestId: string) {
  const key = process.env["RELAY_API_KEY"];
  if (!key) throw Object.assign(new Error("RELAY_API_KEY is not configured"), { code: "RELAY_NOT_CONFIGURED" });
  const res = await fetch(`${BASE_URL}/api/relay/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-relay-api-key": key },
    body: JSON.stringify({ requestId }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; found?: boolean; status?: string; transactionHash?: string | null; error?: string | null; definite?: boolean; ageSeconds?: number; trackingSince?: string };
  if (!res.ok || !data.ok) throw new Error(`relay lookup failed (${res.status})`);
  return { found: !!data.found, ...(data.status ? { status: data.status } : {}), transactionHash: data.transactionHash ?? null, error: data.error ?? null, definite: !!data.definite, ageSeconds: data.ageSeconds ?? 0, ...(data.trackingSince ? { trackingSince: data.trackingSince } : {}) };
}
