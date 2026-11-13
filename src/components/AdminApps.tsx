import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { adminUpdateAppChain } from "@/lib/wallet/chain-admin.functions";
import { adminCreateApp, adminUpdateApp } from "@/lib/wallet/portal.functions";
import { useAdminStats, type AdminStatsData } from "@/components/AdminStats";

type App = AdminStatsData["apps"][number];

/** Everything about the apps connected to the hub: create one, then per app its websites, switches, webhook, limits and keys. */
export function ConnectedApps() {
  const { data, isLoading, error } = useAdminStats();
  const create = useServerFn(adminCreateApp);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [newKey, setNewKey] = useState<{ id: string; app_key: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin-stats"] }); void qc.invalidateQueries({ queryKey: ["admin"] }); };
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Admins only.</p>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Connect a new app</h2>
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
            <p className="mt-1 break-all font-mono text-xs">App ID: {newKey.id}</p>
            <p className="break-all font-mono text-xs">App key: {newKey.app_key}</p>
          </div>
        )}
      </section>
      {data.apps.length === 0 && <p className="text-sm text-muted-foreground">No apps yet.</p>}
      <div className="space-y-4">{data.apps.map((a) => <AppCard key={a.id} app={a} onChange={refresh} />)}</div>
    </main>
  );
}

function AppCard({ app, onChange }: { app: App; onChange: () => void }) {
  const update = useServerFn(adminUpdateApp);
  const updateChain = useServerFn(adminUpdateAppChain);
  const [hook, setHook] = useState(app.webhook_url ?? "");
  const [rate, setRate] = useState(String(app.rate_limit_per_min));
  const [mintCap, setMintCap] = useState(app.daily_mint_cap?.toString() ?? "");
  const [distCap, setDistCap] = useState(app.daily_distribute_cap?.toString() ?? "");
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const revoked = !!app.revoked_at;

  async function save(extra: { rotateWebhookSecret?: boolean; rotateApiKey?: boolean } = {}) {
    try {
      const r = await updateChain({ data: { id: app.id, webhook_url: hook || null, daily_mint_cap: mintCap ? Number(mintCap) : null, daily_distribute_cap: distCap ? Number(distCap) : null, rate_limit_per_min: Number(rate) || app.rate_limit_per_min, ...extra } });
      if (r.webhookSecret) setShown({ label: "Webhook secret", value: r.webhookSecret });
      if (r.apiKey) setShown({ label: "New API key (the old one stops working now)", value: r.apiKey });
      toast.success("Saved"); onChange();
    } catch (e) { toast.error((e as Error).message); }
  }
  const flag = async (k: "popup_enabled" | "api_enabled" | "trusted_oauth", v: boolean) => { await update({ data: { id: app.id, [k]: v } }); onChange(); };

  return (
    <section className={`space-y-4 rounded-xl border bg-card p-5 ${revoked ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{app.name}</h3>
        {app.sandbox && <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">sandbox</span>}
        {revoked && <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-[11px] text-destructive">revoked</span>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{app.id} · {app.key_prefix}…</span>
      </div>

      <EditOrigins app={app} disabled={revoked} onSave={async (list) => { await update({ data: { id: app.id, allowed_origins: list } }); onChange(); }} />

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {(["popup_enabled", "api_enabled", "trusted_oauth"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Switch checked={app[k]} disabled={revoked} onCheckedChange={(v) => flag(k, v)} />
            {k === "popup_enabled" ? "Popup sign-in" : k === "api_enabled" ? "API access" : "Trusted for Google sign-in"}
          </label>
        ))}
      </div>

      {!revoked && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Webhook address<Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://yourapp.com/api/wallet-events" /></label>
            <label className="text-sm">Requests per minute<Input value={rate} onChange={(e) => setRate(e.target.value)} /></label>
            <label className="text-sm">Daily mint limit (tokens)<Input value={mintCap} onChange={(e) => setMintCap(e.target.value)} placeholder="no limit" /></label>
            <label className="text-sm">Daily give-out limit (tokens)<Input value={distCap} onChange={(e) => setDistCap(e.target.value)} placeholder="no limit" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => save()}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => save({ rotateWebhookSecret: true })}>New webhook secret</Button>
            <Button size="sm" variant="outline" onClick={() => { if (confirm("Issue a new API key? The current key stops working immediately.")) void save({ rotateApiKey: true }); }}>New API key</Button>
            <Button size="sm" variant="destructive" className="ml-auto" onClick={async () => { if (confirm(`Revoke ${app.name}? Its key stops working immediately.`)) { await update({ data: { id: app.id, revoke: true } }); onChange(); } }}>Revoke</Button>
          </div>
        </>
      )}
      {shown && (
        <div className="rounded-md border bg-muted p-3 text-sm">
          <p className="font-medium">{shown.label}. Copy it now, it won't be shown again.</p>
          <code className="break-all">{shown.value}</code>
        </div>
      )}
    </section>
  );
}

/** Shows an app's registered websites with a small editor. Browser sign-in (popup) only works from these exact addresses. */
function EditOrigins({ app, disabled, onSave }: { app: App; disabled: boolean; onSave: (list: string[]) => Promise<void> }) {
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
