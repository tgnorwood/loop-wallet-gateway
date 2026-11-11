const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256Hex(s: string) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function sha256B64Url(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return b64(d).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(prefix: string, bytes = 32) {
  const u = crypto.getRandomValues(new Uint8Array(bytes));
  return prefix + toHex(u);
}

export function randomOtp() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return n.toString().padStart(6, "0");
}

async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plain));
  return `v1:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

export async function decryptSecret(blob: string, secret: string) {
  const [v, iv, ct] = blob.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown key format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------------------------------------
// Wallet-key keyring. Private keys are sealed as `v2:<keyId>:<iv>:<ciphertext>` so the key that
// sealed them is always identifiable, which makes rotation safe:
//   WALLET_ENCRYPTION_KEY        the key in use
//   WALLET_ENCRYPTION_KEY_NEXT   optional: when set, new wallets are sealed with it and the admin
//                                "re-encrypt" action moves old wallets over to it
// Old `v1:` blobs (no key id) still open with either key.
// ---------------------------------------------------------------------------------------------
export type Keyring = { current: string; next?: string | undefined };

export async function keyId(secret: string) {
  return (await sha256Hex("loop-wallet-key-id:" + secret)).slice(0, 8);
}

export function keyringFromEnv(): Keyring {
  const current = process.env["WALLET_ENCRYPTION_KEY"];
  if (!current) throw new Error("WALLET_ENCRYPTION_KEY missing");
  const next = process.env["WALLET_ENCRYPTION_KEY_NEXT"];
  return next ? { current, next } : { current };
}

/** The key new data is sealed with. */
export const sealingSecret = (ring: Keyring) => ring.next ?? ring.current;

export async function sealWith(plain: string, ring: Keyring) {
  const secret = sealingSecret(ring);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plain));
  return `v2:${await keyId(secret)}:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

export async function openWith(blob: string, ring: Keyring) {
  const parts = blob.split(":");
  const secrets = [ring.current, ring.next].filter((s): s is string => !!s);
  if (parts[0] === "v1") {
    for (const s of secrets) {
      try { return await decryptSecret(blob, s); } catch { /* try the other key */ }
    }
    throw new Error("Wallet key could not be opened with the configured keys");
  }
  if (parts[0] === "v2" && parts.length === 4) {
    const [, kid, iv, ct] = parts as [string, string, string, string];
    for (const s of secrets) {
      if ((await keyId(s)) !== kid) continue;
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(s), unb64(ct));
      return new TextDecoder().decode(pt);
    }
    throw new Error(`Wallet key was sealed with key ${kid}, which is not configured`);
  }
  throw new Error("Unknown key format");
}

export const sealKey = (plain: string) => sealWith(plain, keyringFromEnv());
export const openKey = (blob: string) => openWith(blob, keyringFromEnv());
