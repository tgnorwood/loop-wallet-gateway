import { hash } from "starknet";
import { ACCOUNT_CLASS_HASH } from "./starknet";

export type Call = { contractAddress: string; entrypoint: string; calldata: string[] };

export const toFelt = (v: string | number | bigint) => "0x" + BigInt(v).toString(16);

export function toPaymasterCalls(calls: Call[]) {
  return calls.map((c) => ({
    to: toFelt(c.contractAddress),
    selector: toFelt(hash.getSelectorFromName(c.entrypoint)),
    calldata: c.calldata.map(toFelt),
  }));
}

/** SNIP-29 deployment data; only sent while the account is still counterfactual. */
export function buildDeployment(address: string, publicKey: string, deployed: boolean) {
  if (deployed) return null;
  return {
    address: toFelt(address),
    class_hash: toFelt(ACCOUNT_CLASS_HASH),
    salt: toFelt(publicKey),
    calldata: [toFelt(publicKey)],
    version: 1,
  };
}

export function buildTransaction(address: string, calls: Call[], deployment: ReturnType<typeof buildDeployment>) {
  const invoke = { user_address: toFelt(address), calls: toPaymasterCalls(calls), version: 1 };
  return deployment ? { type: "deploy_and_invoke", deployment, invoke } : { type: "invoke", invoke };
}
