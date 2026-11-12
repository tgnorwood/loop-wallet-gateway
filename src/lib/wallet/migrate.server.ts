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

/**
 * Moved-in Loop Do wallets were all created here on the day they were imported. This applies each person's
 * ORIGINAL sign-up date (exported from Loop Do) so charts show real growth. Only imported Loop Do wallets are touched.
 */
export async function setCreationDates(p: { appId: string; rows: { externalId: string; createdAt: string }[]; dryRun: boolean; actor: string }) {
  const out: { externalId: string; status: string; address?: string; note?: string }[] = [];
  const floor = Date.parse("2020-01-01");
  const good: { externalId: string; iso: string }[] = [];
  for (const r of p.rows) {
    const t = Date.parse(r.createdAt);
    if (!Number.isFinite(t) || t < floor || t > Date.now() + 864e5) { out.push({ externalId: r.externalId, status: "bad_date", note: r.createdAt.slice(0, 40) }); continue; }
    good.push({ externalId: r.externalId, iso: new Date(t).toISOString() });
  }
  const found = new Map<string, { id: string; address: string; created_at: string; imported_from: string | null }>();
  for (let i = 0; i < good.length; i += 200) {
    const { data } = await db.from("wallets").select("id,external_id,address,created_at,imported_from").eq("app_id", p.appId).eq("network", "sepolia").in("external_id", good.slice(i, i + 200).map((g) => g.externalId));
    for (const w of data ?? []) if (w.external_id) found.set(w.external_id, w);
  }
  const todo: { id: string; iso: string; externalId: string; address: string }[] = [];
  for (const g of good) {
    const w = found.get(g.externalId);
    if (!w) { out.push({ externalId: g.externalId, status: "not_found" }); continue; }
    if (!w.imported_from?.startsWith("loop-do")) { out.push({ externalId: g.externalId, status: "skipped", address: w.address, note: "not a moved-in Loop Do wallet" }); continue; }
    if (Math.abs(Date.parse(w.created_at) - Date.parse(g.iso)) < 1000) { out.push({ externalId: g.externalId, status: "unchanged", address: w.address }); continue; }
    if (p.dryRun) { out.push({ externalId: g.externalId, status: "would_update", address: w.address, note: `${w.created_at.slice(0, 10)} → ${g.iso.slice(0, 10)}` }); continue; }
    todo.push({ id: w.id, iso: g.iso, externalId: g.externalId, address: w.address });
  }
  let i = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (i < todo.length) {
      const t = todo[i++]!;
      const { error } = await db.from("wallets").update({ created_at: t.iso }).eq("id", t.id);
      out.push({ externalId: t.externalId, status: error ? "error" : "updated", address: t.address, ...(error ? { note: error.message.slice(0, 120) } : { note: t.iso.slice(0, 10) }) });
    }
  }));
  if (!p.dryRun && todo.length) await audit({ app_id: p.appId, action: "wallet_dates_set", details: { updated: out.filter((r) => r.status === "updated").length, admin: p.actor } });
  return out;
}

/**
 * Estimates when each moved-in Loop Do wallet was really created from its FIRST on-chain activity (its earliest
 * transfer in or out). Approximate: it is the day the wallet first held or sent something, not the day the person
 * signed up. Only wallets still carrying the import-day date are touched, so real dates loaded from a Loop Do
 * export are never overwritten. Needs the database function wallet_first_activity() (docs/lovable-db-changes.md).
 */
export async function estimateWalletDates(p: { dryRun: boolean; actor: string }) {
  const r = await (db.rpc as unknown as (n: string) => Promise<{ data: { wallet_id: string; address: string; first_block: number | string }[] | null; error: { message: string } | null }>)("wallet_first_activity");
  if (r.error) return { ok: false as const, error: /could not find|does not exist/i.test(r.error.message) ? "The database function wallet_first_activity() is not installed yet. Ask Lovable to apply the third migration in docs/lovable-db-changes.md." : r.error.message };
  const found = (r.data ?? []).map((x) => ({ id: x.wallet_id, block: Number(x.first_block) }));

  // The import day = the day most moved-in wallets share. Only wallets dated near it still need fixing.
  const { data: all } = await db.from("wallets").select("id,created_at").like("imported_from", "loop-do%").limit(20000);
  const perDay = new Map<string, number>();
  for (const w of all ?? []) perDay.set(w.created_at.slice(0, 10), (perDay.get(w.created_at.slice(0, 10)) ?? 0) + 1);
  const importDay = [...perDay].sort((a, b) => b[1] - a[1])[0]?.[0];
  const createdAt = new Map((all ?? []).map((w) => [w.id, w.created_at]));
  const importedTotal = all?.length ?? 0;
  if (!importDay) return { ok: true as const, importedTotal, withActivity: 0, noActivity: 0, alreadyDated: 0, updated: 0, earliest: null, latest: null, byDay: [] as { day: string; n: number }[], complete: true, dryRun: p.dryRun };
  const near = (iso: string) => Math.abs(Date.parse(iso) - Date.parse(importDay + "T12:00:00Z")) <= 36 * 3600_000;

  const { estimateTimes, dayOf } = await import("./chain-time.server");
  const eligible = found.filter((f) => createdAt.has(f.id) && near(createdAt.get(f.id)!));
  const { times, complete } = await estimateTimes(eligible.map((f) => f.block));
  const plan = eligible.flatMap((f) => { const t = times.get(f.block); return t !== undefined && t * 1000 < Date.parse(createdAt.get(f.id)!) ? [{ id: f.id, iso: new Date(t * 1000).toISOString() }] : []; });

  let updated = 0;
  if (!p.dryRun) {
    let i = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (i < plan.length) {
        const x = plan[i++]!;
        const { error } = await db.from("wallets").update({ created_at: x.iso }).eq("id", x.id);
        if (!error) updated++;
      }
    }));
    if (updated) await audit({ action: "wallet_dates_estimated", details: { updated, import_day: importDay, admin: p.actor } });
  }
  const byDayMap = new Map<string, number>();
  for (const x of plan) byDayMap.set(dayOf(Date.parse(x.iso) / 1000), (byDayMap.get(dayOf(Date.parse(x.iso) / 1000)) ?? 0) + 1);
  const days = [...byDayMap].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    ok: true as const, importedTotal, withActivity: found.length, noActivity: importedTotal - found.length, alreadyDated: found.length - eligible.length,
    updated: p.dryRun ? 0 : updated, wouldUpdate: plan.length, earliest: days[0]?.[0] ?? null, latest: days.at(-1)?.[0] ?? null,
    byDay: days.map(([day, n]) => ({ day, n })), complete, dryRun: p.dryRun,
  };
}
