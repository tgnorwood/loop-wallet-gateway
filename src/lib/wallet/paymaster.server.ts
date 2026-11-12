// Sponsored execution through the Token Factory AVNU paymaster proxy (ported from Loop Do).
import { Signer } from "starknet";
import { rpcFetch } from "./rpc.server";
import { buildDeployment, buildTransaction, toFelt, type Call } from "./paymaster";

const NETWORK = "sepolia";
function paymasterUrl() {
  return process.env["PAYMASTER_URL"] ?? `https://token-factory-console.pages.dev/api/paymaster/${NETWORK}`;
}
export { rpcUrl } from "./rpc.server";

let rpcId = 0;
async function pm(method: string, params: Record<string, unknown>) {
  const res = await fetch(paymasterUrl(), {
    method: "POST",
    // The proxy requires this key once it is locked (mainnet always). Same secret core.ts already sends.
    headers: { "Content-Type": "application/json", ...(process.env["PAYMASTER_API_KEY"] ? { "x-paymaster-api-key": process.env["PAYMASTER_API_KEY"] } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params: [params] }),
  });
  const text = await res.text();
  let json: { result?: unknown; error?: { message?: string; data?: unknown } } | null = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok || json?.error) {
    const d = json?.error?.data;
    throw new Error(`paymaster ${method} failed (${res.status}): ${json?.error?.message ?? text.slice(0, 200)}${d ? " | " + (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 400) : ""}`);
  }
  return (json?.result ?? json ?? {}) as Record<string, unknown>;
}

export async function isDeployedOnChain(address: string) {
  const res = await rpcFetch(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_getClassHashAt", params: { block_id: "latest", contract_address: address } }));
  const j = (await res.json()) as { result?: string };
  return !!j.result;
}

export async function executeSponsored(p: { address: string; publicKey: string; privateKey: string; deployed: boolean; calls: Call[] }) {
  const deployed = p.deployed || (await isDeployedOnChain(p.address));
  const deployment = buildDeployment(p.address, p.publicKey, deployed);
  const transaction = buildTransaction(p.address, p.calls, deployment);
  const parameters = { version: "0x1", fee_mode: { mode: "sponsored" } };
  const built = await pm("paymaster_buildTransaction", { transaction, parameters });
  const typedData = (built["typed_data"] ?? built["typedData"]) as never;
  if (!typedData) throw new Error("paymaster did not return typed_data to sign");
  const sig = (await new Signer(p.privateKey).signMessage(typedData, p.address)) as unknown;
  const sigArray = (Array.isArray(sig) ? sig.map(String) : [String((sig as { r: bigint }).r), String((sig as { s: bigint }).s)]).map(toFelt);
  const userInvoke = { user_address: toFelt(p.address), typed_data: typedData, signature: sigArray };
  const executed = await pm("paymaster_executeTransaction", {
    transaction: deployment ? { type: "deploy_and_invoke", deployment, invoke: userInvoke } : { type: "invoke", invoke: userInvoke },
    parameters: built["parameters"] ?? parameters,
  });
  const txHash = (executed["transaction_hash"] ?? executed["transactionHash"]) as string | undefined;
  if (!txHash) throw new Error("paymaster did not return a transaction hash");
  return { transaction_hash: txHash, deployed_now: !!deployment };
}
