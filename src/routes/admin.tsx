import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { AdminOnly } from "@/components/AdminOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { adminCreateApp, adminOverview, adminRevokeSessions, adminSearch, adminUpdateApp } from "@/lib/wallet/portal.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin console — Loop Wallet Hub" },
      { name: "description", content: "Manage partner apps, keys, domains and wallet security." },
      { property: "og:title", content: "Admin console — Loop Wallet Hub" },
      { property: "og:description", content: "Manage partner apps, keys, domains and wallet security." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <AdminOnly><Admin /></AdminOnly>
    </div>
  );
}

function Admin() {
  const overview = useServerFn(adminOverview);
  const { data, error, isLoading } = useQuery({ queryKey: ["admin"], queryFn: () => overview(), retry: false });
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-8 text-destructive">Admins only.</p>;
  const d = data!;
  const pct = d.totalWallets ? Math.round((d.verifiedWallets / d.totalWallets) * 100) : 0;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="grid gap-4 sm:grid-cols-5">
        <Stat label="Total wallets" value={d.totalWallets} />
        <Stat label="Verified" value={`${pct}%`} />
        <Stat label="Recent takeovers" value={d.takeovers.length} />
        <Stat label="Signatures (7 days)" value={d.signsLast7d} />
        <Stat label="Transactions (7 days)" value={d.txsLast7d} />
      </div>
      <Apps apps={d.apps} />
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
              <p className="text-xs text-muted-foreground">{a.allowed_origins.join(", ") || "No websites"}</p>
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
