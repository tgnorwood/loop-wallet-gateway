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

export type ImportRow = { externalId: string; email?: string | undefined; salt?: string | undefined; address?: string | undefined; kind?: string | undefined };
export type ImportResult = { externalId: string; status: "created" | "exists" | "mismatch" | "error" | "would_create"; address?: string; note?: string };

export async function importWallets(p: { appId: string; source: "loop-do" | "new"; rows: ImportRow[]; dryRun: boolean; actor: string }) {
  const encKey = process.env["WALLET_ENCRYPTION_KEY"];
  if (!encKey) throw new Error("WALLET_ENCRYPTION_KEY missing");
  const pepper = process.env["LOOPDO_WALLET_DERIVATION_SECRET"];
  if (p.source === "loop-do" && !pepper) throw new Error("Add the Loop Do derivation secret (LOOPDO_WALLET_DERIVATION_SECRET) first");
  const out: ImportResult[] = [];
  for (const row of p.rows) {
    try {
      const { data: exists } = await db.from("wallets").select("id,address").eq("app_id", p.appId).eq("network", "sepolia").eq("external_id", row.externalId).maybeSingle();
      if (exists) { out.push({ externalId: row.externalId, status: "exists", address: exists.address }); continue; }
      let w: { privateKey: string; publicKey: string; address: string };
      if (p.source === "loop-do") {
        if (!row.salt) { out.push({ externalId: row.externalId, status: "error", note: "salt missing" }); continue; }
        w = await deriveLoopDoKey(pepper!, row.externalId, row.salt);
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
