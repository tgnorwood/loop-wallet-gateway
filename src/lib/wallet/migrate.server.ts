// Admin bulk tools. Server-only.
// The one-time Loop Do migration (push endpoints, derivation-secret re-derivation, wallet CSV with
// private keys) has been removed now that it is finished; see git history before this commit to recover it.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sealKey } from "./crypto";
import { ACCOUNT_CLASS_HASH, generateWallet } from "./starknet";
import { audit } from "./service.server";
import { normalizeEmail } from "./rules";

const db = supabaseAdmin;

export type ImportRow = { externalId: string; email?: string | undefined; kind?: string | undefined };
export type ImportResult = { externalId: string; status: "created" | "exists" | "error" | "would_create"; address?: string; note?: string };

/** Creates brand-new custodial wallets for an app's existing users (e.g. Loop Fans fans). */
export async function importWallets(p: { appId: string; rows: ImportRow[]; dryRun: boolean; actor: string }) {
  const out: ImportResult[] = [];
  for (const row of p.rows) {
    try {
      const { data: exists } = await db.from("wallets").select("id,address").eq("app_id", p.appId).eq("network", "sepolia").eq("external_id", row.externalId).maybeSingle();
      if (exists) { out.push({ externalId: row.externalId, status: "exists", address: exists.address }); continue; }
      const w = generateWallet();
      let email = row.email ? normalizeEmail(row.email) : null;
      let note: string | undefined;
      if (email) {
        const { data: t } = await db.from("wallets").select("id").eq("email", email).eq("network", "sepolia").maybeSingle();
        if (t) { note = "email already has a hub wallet; created without email"; email = null; }
      }
      if (p.dryRun) { out.push({ externalId: row.externalId, status: "would_create", address: w.address, ...(note ? { note } : {}) }); continue; }
      const { data, error } = await db.from("wallets").insert({
        app_id: p.appId, network: "sepolia", external_id: row.externalId, kind: row.kind ?? "user", email, address: w.address, public_key: w.publicKey,
        class_hash: ACCOUNT_CLASS_HASH, encrypted_private_key: await sealKey(w.privateKey), imported_from: "new", created_by_app: p.appId,
      }).select("id").single();
      w.privateKey = "";
      if (error) throw error;
      await audit({ app_id: p.appId, wallet_id: data.id, action: "wallet_imported", details: { source: "new", admin: p.actor } });
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
    await db.from("tokens").insert({ app_id: p.appId, network: "sepolia", address, name: r.name, symbol: r.symbol, swappable: !!r.swappable, imported_from: "loop-do", sync_enabled: true });
    res.push({ address, status: "created" });
  }
  return res;
}
