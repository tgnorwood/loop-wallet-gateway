import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { AdminOnly } from "@/components/AdminOnly";
import { AdminConsole } from "@/components/DashboardPage";
import { IssuesBanner } from "@/components/AdminIssues";
import { loopPreviewMeta } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminCreateApp, adminOverview, adminRevokeSessions, adminSearch, adminUpdateApp } from "@/lib/wallet/portal.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      ...loopPreviewMeta,
      { title: "Admin console — Loop Wallet Hub" },
      { name: "description", content: "Manage partner apps, keys, domains and wallet security." },
      { property: "og:title", content: "Admin console — Loop Wallet Hub" },
      { property: "og:description", content: "Manage partner apps, keys, domains and wallet security." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const tab = "rounded-md px-4 py-1.5 text-sm";
  return (
    <div className="min-h-screen">
      <AppHeader />
      <AdminOnly>
        <div className="mx-auto max-w-6xl px-4 pt-6"><IssuesBanner /></div>
        <Tabs defaultValue="console" id="admin-tabs">
          <div className="mx-auto max-w-6xl px-4 pt-6">
            <TabsList>
              <TabsTrigger value="console" className={tab}>Console</TabsTrigger>
              <TabsTrigger value="apps" className={tab}>Partner apps</TabsTrigger>
              <TabsTrigger value="wallets" className={tab}>Wallets &amp; security</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="console"><AdminConsole /></TabsContent>
          <TabsContent value="apps"><AppsTab /></TabsContent>
          <TabsContent value="wallets"><WalletsTab /></TabsContent>
        </Tabs>
      </AdminOnly>
    </div>
  );
}

function useOverview() {
  const overview = useServerFn(adminOverview);
  return useQuery({ queryKey: ["admin"], queryFn: () => overview(), retry: false });
}

/** Partner apps: create, edit websites, switches, keys. */
function AppsTab() {
  const { data, error, isLoading } = useOverview();
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Admins only.</p>;
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-6"><Apps apps={data.apps} /></main>;
}

/** Wallet health numbers, wallet lookup by email or address, and recent takeovers. */
function WalletsTab() {
  const { data: d, error, isLoading } = useOverview();
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !d) return <p className="p-8 text-destructive">Admins only.</p>;
  const pct = d.totalWallets ? Math.round((d.verifiedWallets / d.totalWallets) * 100) : 0;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="grid gap-4 sm:grid-cols-5">
        <Stat label="Total wallets" value={d.totalWallets} />
        <Stat label="Verified" value={`${pct}%`} />
        <Stat label="Recent takeovers" value={d.takeovers.length} />
        <Stat label="Signatures (7 days)" value={d.signsLast7d} />
        <Stat label="Transactions (7 days)" value={d.txsLast7d} />
      </div>
      <Search />
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Recent takeovers</h2>
        {d.takeovers.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {d.takeovers.map((t) => (
          <div key={t.id} className="flex justify-between border-t py-2 text-sm">
            <span>{(t.wallets as { email: string } | null)?.email}</span>
            <span className="text-muted-foreground">{t.method} · {t.ip ?? "—"} · {new Date(t.created_at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </main>
  );
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>
);

type AppRow = Awaited<ReturnType<typeof adminOverview>>["apps"][number];

function Apps({ apps }: { apps: AppRow[] }) {
  const create = useServerFn(adminCreateApp);
  const update = useServerFn(adminUpdateApp);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [newKey, setNewKey] = useState<{ id: string; app_key: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Partner apps</h2>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await create({ data: { name, allowed_origins: origins.split(/[\s,]+/).filter(Boolean) } });
            setNewKey(r); setName(""); setOrigins(""); refresh();
          } catch (err) { toast.error((err as Error).message); }
        }}
      >
        <Input className="w-48" placeholder="App name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input className="flex-1" placeholder="Allowed websites, e.g. https://loopfans.com" value={origins} onChange={(e) => setOrigins(e.target.value)} />
        <Button type="submit">Create app</Button>
      </form>
      {newKey && (
        <div className="mt-3 rounded border border-primary/40 bg-primary/10 p-3 text-sm">
          <p className="font-medium">Copy this app key now. It won't be shown again.</p>
          <p className="mt-1 font-mono text-xs break-all">App ID: {newKey.id}</p>
          <p className="font-mono text-xs break-all">App key: {newKey.app_key}</p>
        </div>
      )}
      <div className="mt-4 divide-y">
        {apps.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 py-3 text-sm">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{a.name} {a.sandbox && <span className="text-xs text-muted-foreground">(sandbox)</span>} {a.revoked_at && <span className="text-xs text-destructive">revoked</span>}</p>
              <p className="font-mono text-xs text-muted-foreground">{a.id} · {a.key_prefix}…</p>
              <EditOrigins app={a} disabled={!!a.revoked_at} onSave={async (list) => { await update({ data: { id: a.id, allowed_origins: list } }); refresh(); }} />
            </div>
            {(["popup_enabled", "api_enabled", "trusted_oauth"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <Switch checked={a[k]} disabled={!!a.revoked_at} onCheckedChange={async (v) => { await update({ data: { id: a.id, [k]: v } }); refresh(); }} />
                {k === "popup_enabled" ? "Popup" : k === "api_enabled" ? "API" : "Trusted for Google sign-in"}
              </label>
            ))}
            {!a.revoked_at && (
              <Button size="sm" variant="destructive" onClick={async () => { if (confirm(`Revoke ${a.name}?`)) { await update({ data: { id: a.id, revoke: true } }); refresh(); } }}>Revoke</Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Search() {
  const search = useServerFn(adminSearch);
  const revoke = useServerFn(adminRevokeSessions);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Awaited<ReturnType<typeof adminSearch>> | undefined>(undefined);
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Find a wallet</h2>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setRes(await search({ data: { q } })); }}>
        <Input placeholder="Email or 0x address" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {res === null && <p className="mt-3 text-sm text-muted-foreground">No wallet found.</p>}
      {res && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{res.wallet.email}</p>
              <p className="font-mono text-xs text-muted-foreground break-all">{res.wallet.address}</p>
              <p className="text-xs text-muted-foreground">{res.wallet.verified ? `Verified (${res.wallet.verified_method})` : "Unverified"} · {res.activeSessions} active sessions</p>
            </div>
            <Button variant="destructive" size="sm" onClick={async () => { await revoke({ data: { walletId: res.wallet.id } }); toast.success("Sessions revoked"); setRes(await search({ data: { q } })); }}>Revoke sessions</Button>
          </div>
          <div className="mt-3 max-h-80 divide-y overflow-auto">
            {res.logs.map((l) => (
              <div key={l.id} className="flex justify-between py-1.5 text-xs">
                <span>{l.action}{(l.details as { tx_hash?: string } | null)?.tx_hash && (<> · <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://sepolia.voyager.online/tx/${(l.details as { tx_hash: string }).tx_hash}`}>view tx</a></>)}{l.method ? ` · ${l.method}` : ""}{(l.registered_apps as { name: string } | null) ? ` · ${(l.registered_apps as { name: string }).name}` : ""}</span>
                <span className="text-muted-foreground">{l.ip ?? "—"} · {new Date(l.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Shows an app's registered websites with a small editor. Browser sign-in (popup) only works from these exact addresses. */
function EditOrigins({ app, disabled, onSave }: { app: AppRow; disabled: boolean; onSave: (list: string[]) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <p className="text-xs text-muted-foreground">
        {app.allowed_origins.join(", ") || "No websites"}
        {!disabled && <button className="ml-2 underline hover:text-foreground" onClick={() => { setText(app.allowed_origins.join("\n")); setEditing(true); }}>Edit websites</button>}
      </p>
    );
  }
  async function save() {
    const list = text.split(/[\s,]+/).filter(Boolean);
    const bad = list.find((u) => { try { return !["http:", "https:"].includes(new URL(u).protocol); } catch { return true; } });
    if (bad) { toast.error(`"${bad}" is not a web address (use the full form, e.g. https://loop.do)`); return; }
    setBusy(true);
    try { await onSave(list); toast.success("Websites saved"); setEditing(false); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-1 space-y-2">
      <textarea className="h-20 w-full rounded-md border bg-background p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="One per line, e.g. https://loop.do" />
      <p className="text-xs text-muted-foreground">Each address must match exactly. https://loop.do and https://www.loop.do are different, so add both if you use both.</p>
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={save}>Save</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
    </div>
  );
}
