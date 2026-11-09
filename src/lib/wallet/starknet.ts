import { ec, hash, stark, typedData, CallData, type TypedData } from "starknet";

/**
 * SNIP-9 account class (supports execute_from_outside_v2, so paymasters can sponsor
 * deploy_and_invoke). The old OpenZeppelin v0.8.1 class
 * 0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f is rejected by
 * paymasters ("invalid paymaster version") and must never be used.
 */
export const ACCOUNT_CLASS_HASH =
  "0x02b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f";
export const LEGACY_REJECTED_CLASS_HASH =
  "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

export const STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Derivation: calldata = [publicKey], salt = publicKey, deployer = 0. */
export function deriveAddress(publicKey: string, classHash = ACCOUNT_CLASS_HASH): string {
  const addr = hash.calculateContractAddressFromHash(
    publicKey,
    classHash,
    CallData.compile([publicKey]),
    0,
  );
  return "0x" + BigInt(addr).toString(16).padStart(64, "0");
}

export function generateWallet() {
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  return {
    privateKey,
    publicKey,
    address: deriveAddress(publicKey),
    classHash: ACCOUNT_CLASS_HASH,
  };
}

export function signTypedMessage(privateKey: string, address: string, data: TypedData) {
  const msgHash = typedData.getMessageHash(data, address);
  const sig = ec.starkCurve.sign(msgHash, privateKey);
  return {
    message_hash: msgHash,
    signature: ["0x" + sig.r.toString(16), "0x" + sig.s.toString(16)],
  };
}

export function isValidAddress(a: string) {
  return /^0x[0-9a-fA-F]{1,64}$/.test(a);
}
