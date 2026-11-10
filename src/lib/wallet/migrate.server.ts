// One-time wallet migration into the hub. Server-only.
// Loop Do: keys are HKDF(WALLET_DERIVATION_SECRET, salt, "loop-chain-wallet:<user_id>") ground onto the
// Stark curve. Re-deriving here keeps the SAME address, so on-chain balances stay where they are.
import { ec } from "starknet";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret } from "./crypto";
import { ACCOUNT_CLASS_HASH, deriveAddress, generateWallet } from "./starknet";
import { audit } from "./service.server";
import { sameAddress } from "./chain-rules";

const db = supabaseAdmin;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array((h.replace(/^0x/, "").match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

export async function deriveLoopDoKey(pepper: string, userId: string, salt: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: fromHex(salt), info: enc.encode(`loop-chain-wallet:${userId}`) }, key, 256);
  const priv = ec.starkCurve.grindKey("0x" + hex(new Uint8Array(bits)));
  const privateKey = "0x" + priv.replace(/^0x/, "");
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  return { privateKey, publicKey, address: deriveAddress(publicKey) };
}

export type ImportRow = { externalId: string; privateKey?: string | undefined; email?: string | undefined; salt?: string | undefined; address?: string | undefined; kind?: string | undefined };
export type ImportResult = { externalId: string; status: "created" | "exists" | "mismatch" | "error" | "would_create"; address?: string; note?: string };

export async function importWallets(p: { appId: string; source: "loop-do" | "new"; rows: ImportRow[]; dryRun: boolean; actor: string }) {
  const encKey = process.env["WALLET_ENCRYPTION_KEY"];
  if (!encKey) throw new Error("WALLET_ENCRYPTION_KEY missing");
  const pepper = process.env["LOOPDO_WALLET_DERIVATION_SECRET"];
  if (p.source === "loop-do" && !pepper && p.rows.some((r) => !r.privateKey)) throw new Error("Rows need a private_key column (or the correct Loop Do derivation secret)");
  const out: ImportResult[] = [];
  for (const row of p.rows) {
    try {
      const { data: exists } = await db.from("wallets").select("id,address").eq("app_id", p.appId).eq("network", "sepolia").eq("external_id", row.externalId).maybeSingle();
      if (exists) { out.push({ externalId: row.externalId, status: "exists", address: exists.address }); continue; }
      let w: { privateKey: string; publicKey: string; address: string };
      if (p.source === "loop-do") {
        if (row.privateKey) {
          if (!/^0x[0-9a-fA-F]{1,64}$/.test(row.privateKey)) { out.push({ externalId: row.externalId, status: "error", note: "private_key is not a 0x hex value" }); continue; }
          const publicKey = ec.starkCurve.getStarkKey(row.privateKey);
          w = { privateKey: row.privateKey, publicKey, address: deriveAddress(publicKey) };
        } else {
          if (!row.salt) { out.push({ externalId: row.externalId, status: "error", note: "salt or private_key missing" }); continue; }
          w = await deriveLoopDoKey(pepper!, row.externalId, row.salt);
        }
        if (row.address && !sameAddress(row.address, w.address)) { out.push({ externalId: row.externalId, status: "mismatch", address: w.address, note: `expected ${row.address}` }); continue; }
      } else {
        w = generateWallet();
      }
      const { data: addrTaken } = await db.from("wallets").select("id").eq("address", w.address).maybeSingle();
      if (addrTaken) { out.push({ externalId: row.externalId, status: "exists", address: w.address, note: "address already in hub" }); continue; }
      let email = row.email?.trim().toLowerCase() || null;
      let note: string | undefined;
      if (email) { const { data: t } = await db.from("wallets").select("id").eq("email", email).maybeSingle(); if (t) { note = "email already has a hub wallet; imported without email"; email = null; } }
      if (p.dryRun) { out.push({ externalId: row.externalId, status: "would_create", address: w.address, ...(note ? { note } : {}) }); continue; }
      const { data, error } = await db.from("wallets").insert({
        app_id: p.appId, network: "sepolia", external_id: row.externalId, kind: row.kind ?? "user", email, address: w.address, public_key: w.publicKey,
        class_hash: ACCOUNT_CLASS_HASH, encrypted_private_key: await encryptSecret(w.privateKey, encKey), imported_from: p.source, created_by_app: p.appId,
      }).select("id").single();
      w.privateKey = "";
      if (error) throw error;
      await audit({ app_id: p.appId, wallet_id: data.id, action: "wallet_imported", details: { source: p.source, admin: p.actor } });
      out.push({ externalId: row.externalId, status: "created", address: w.address, ...(note ? { note } : {}) });
    } catch (e) {
      out.push({ externalId: row.externalId, status: "error", note: String((e as Error).message).slice(0, 200) });
    }
  }
  return out;
}

export async function importTokens(p: { appId: string; rows: { address: string; name: string; symbol: string; swappable?: boolean }[]; dryRun: boolean }) {
  const res: { address: string; status: string }[] = [];
  for (const r of p.rows) {
    const address = "0x" + BigInt(r.address).toString(16).padStart(64, "0");
    const { data: ex } = await db.from("tokens").select("id").eq("network", "sepolia").eq("address", address).maybeSingle();
    if (ex) { res.push({ address, status: "exists" }); continue; }
    if (p.dryRun) { res.push({ address, status: "would_create" }); continue; }
    await db.from("tokens").insert({ app_id: p.appId, network: "sepolia", address, name: r.name, symbol: r.symbol, swappable: !!r.swappable });
    res.push({ address, status: "created" });
  }
  return res;
}

// ---- Push migration from Loop Do (wallet-migrate-custodial) ----
// Loop Do encrypts each Stark key with the shared transport key WALLET_MASTER_KEY
// (AES-256-GCM, address as AAD). We decrypt, check the key really owns the address,
// then re-encrypt with our own storage key. The transport key is never used for storage.
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const normAddr = (a: string) => "0x" + BigInt(a).toString(16);

export async function importTransportKey(raw: string) {
  const v = raw.trim();
  const bytes = /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? fromHex(v.padStart(64, "0")) : unb64(v);
  if (bytes.length !== 32) throw new Error("WALLET_MASTER_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"]);
}

type PushedWallet = { source_wallet_id?: string; user_id: string; address: string; public_key: string; class_hash: string; encrypted_private_key: { iv: string; ciphertext: string } };

export async function receiveLoopDoWallets(wallets: PushedWallet[]) {
  const encKey = process.env["WALLET_ENCRYPTION_KEY"];
  const transport = process.env["WALLET_MASTER_KEY"];
  if (!encKey || !transport) throw new Error("WALLET_ENCRYPTION_KEY / WALLET_MASTER_KEY missing");
  const { data: app } = await db.from("registered_apps").select("id").ilike("name", "%loop do%").is("revoked_at", null).order("created_at").limit(1).maybeSingle();
  if (!app) throw new Error("Create an app named 'Loop Do' in the Admin page first");
  const key = await importTransportKey(transport);
  const out: ImportResult[] = [];
  for (const w of wallets) {
    const externalId = String(w.user_id ?? "");
    try {
      if (!externalId || !w.address || !w.encrypted_private_key?.iv) { out.push({ externalId, status: "error", note: "missing fields" }); continue; }
      const stored = normAddr(w.address);
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.encrypted_private_key.iv), additionalData: new TextEncoder().encode(stored), tagLength: 128 }, key, unb64(w.encrypted_private_key.ciphertext)));
      let privateKey = "0x" + hex(pt); pt.fill(0);
      const publicKey = ec.starkCurve.getStarkKey(privateKey);
      const classHash = w.class_hash;
      if (normAddr(deriveAddress(publicKey, classHash)) !== stored) { privateKey = ""; out.push({ externalId, status: "mismatch", address: w.address }); continue; }
      const address = "0x" + BigInt(w.address).toString(16).padStart(64, "0");
      const { data: ex } = await db.from("wallets").select("id").or(`address.eq.${address},and(app_id.eq.${app.id},external_id.eq.${externalId})`).limit(1).maybeSingle();
      if (ex) { privateKey = ""; out.push({ externalId, status: "exists", address }); continue; }
      const { data, error } = await db.from("wallets").insert({
        app_id: app.id, network: "sepolia", external_id: externalId, kind: "user", address, public_key: publicKey, class_hash: classHash,
        encrypted_private_key: await encryptSecret(privateKey, encKey), imported_from: "loop-do", created_by_app: app.id,
      }).select("id").single();
      privateKey = "";
      if (error) throw error;
      await audit({ app_id: app.id, wallet_id: data.id, action: "wallet_imported", details: { source: "loop-do-push", legacy_class: classHash !== ACCOUNT_CLASS_HASH } });
      out.push({ externalId, status: "created", address, ...(classHash !== ACCOUNT_CLASS_HASH ? { note: "old account type: gas-free sends won't work" } : {}) });
    } catch (e) {
      out.push({ externalId, status: "error", note: e instanceof DOMException ? "could not decrypt (wrong WALLET_MASTER_KEY?)" : String((e as Error).message).slice(0, 200) });
    }
  }
  return out;
}
