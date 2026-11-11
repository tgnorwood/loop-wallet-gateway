// Moves every wallet's private key from the key it was sealed with to WALLET_ENCRYPTION_KEY_NEXT.
// Server-only. Safe to run repeatedly: wallets already on the target key are skipped, each rewrite is
// verified by decrypting it again, and a wallet changed by someone else mid-run is left untouched.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { keyId, keyringFromEnv, openWith, sealWith, sealingSecret } from "./crypto";
import { audit } from "./service.server";

const db = supabaseAdmin;

export async function keyStatus() {
  const ring = keyringFromEnv();
  const currentId = await keyId(ring.current);
  const nextId = ring.next ? await keyId(ring.next) : null;
  const targetId = nextId ?? currentId;
  const [all, onTarget, onCurrent] = await Promise.all([
    db.from("wallets").select("id", { count: "exact", head: true }),
    db.from("wallets").select("id", { count: "exact", head: true }).like("encrypted_private_key", `v2:${targetId}:%`),
    db.from("wallets").select("id", { count: "exact", head: true }).like("encrypted_private_key", `v2:${currentId}:%`),
  ]);
  return {
    currentKeyId: currentId,
    nextKeyId: nextId,
    nextConfigured: !!ring.next,
    wallets: all.count ?? 0,
    onTargetKey: onTarget.count ?? 0,
    onCurrentKey: onCurrent.count ?? 0,
    remaining: Math.max(0, (all.count ?? 0) - (onTarget.count ?? 0)),
  };
}

/** Re-encrypts up to `limit` wallets. Requires WALLET_ENCRYPTION_KEY_NEXT. */
export async function rotateWalletKeys(limit = 200, dryRun = false, admin = "") {
  const ring = keyringFromEnv();
  if (!ring.next) throw new Error("Set WALLET_ENCRYPTION_KEY_NEXT first");
  const targetId = await keyId(sealingSecret(ring));
  const { data: rows } = await db.from("wallets").select("id,encrypted_private_key").not("encrypted_private_key", "like", `v2:${targetId}:%`).limit(limit);
  let rotated = 0, failed = 0;
  const errors: string[] = [];
  for (const w of rows ?? []) {
    try {
      const plain = await openWith(w.encrypted_private_key, ring);
      const sealed = await sealWith(plain, ring);
      if ((await openWith(sealed, { current: sealingSecret(ring) })) !== plain) throw new Error("round-trip check failed");
      if (!dryRun) {
        const { data: done } = await db.from("wallets").update({ encrypted_private_key: sealed }).eq("id", w.id).eq("encrypted_private_key", w.encrypted_private_key).select("id");
        if (!done?.length) continue; // changed meanwhile; next run picks it up
      }
      rotated++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(`${w.id}: ${(e as Error).message}`.slice(0, 160));
    }
  }
  if (!dryRun && rotated) await audit({ action: "wallet_keys_rotated", details: { rotated, failed, admin, target_key_id: targetId } });
  const status = await keyStatus();
  return { rotated, failed, errors, dryRun, ...status };
}
