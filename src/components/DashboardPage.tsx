import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PublicDashboard } from "@/components/PublicDashboard";
import { fromBaseUnits, publicTransactionStatus } from "@/lib/wallet/chain-rules";
import { adminEstimateWalletDates, adminImport, adminKeyStatus, adminLinkImportedWallet, adminMarkTest, adminNewWallets, adminResolveTransaction, adminResyncToken, adminRotateKeys, adminTokenHistory, adminUpdateAppChain, chainDashboard } from "@/lib/wallet/chain-admin.functions";

/** The home page: public, aggregate numbers only. The admin console lives on the Admin page. */
export function DashboardPage() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <PublicDashboard />
    </div>
  );
}

const short = (a?: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "pending");
const voyager = (kind: "tx" | "contract", v: string) => `https://sepolia.voyager.online/${kind}/${v}`;
const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) => (
  <div className="rounded-xl border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold">{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/** Transactions, wallets log, tokens, collections, apps, imports and security. Shown at the bottom of the Admin page. */
export function AdminConsole() {
  const fetchDash = useServerFn(chainDashboard);
  const [appId, setAppId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [hideTest, setHideTest] = useState(true);
  const { data, error, isLoading } = useQuery({
    queryKey: ["chain-dash", appId, status, hideTest],
    queryFn: () => fetchDash({ data: { appId: appId || null, status: status || null, hideTest } }),
    refetchInterval: 10_000,
    retry: false,
  });
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-8 text-destructive">Admins only.</p>;
  const s = data.stats;
  const appName = (id: string) => data.apps.find((a) => a.id === id)?.name ?? "—";

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {data.transactions.some((t) => publicTransactionStatus(t.status, t.error_code) === "unknown") && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {data.transactions.filter((t) => publicTransactionStatus(t.status, t.error_code) === "unknown").length} transaction(s) have an unknown outcome and are holding up their queue. Open the Activity log and resolve them.
        </div>
      )}
      {!data.relayConfigured && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          The operator relay key is not set yet, so creating tokens, distributing, creating collections and minting will fail until it is added. Wallet transfers and edits work already.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={appId} onChange={(e) => setAppId(e.target.value)}>
          <option value="">All apps</option>
          {data.apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={hideTest} onCheckedChange={setHideTest} /> Hide test items</label>
        <a className="ml-auto text-sm text-primary underline" href="https://token-factory-console.pages.dev/dashboard" target="_blank" rel="noreferrer">Full on-chain history ↗</a>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Wallets" value={s.wallets} />
        <Stat label="Tokens" value={s.tokens} />
        <Stat label="Collections" value={s.collections} />
        <Stat label="NFTs" value={s.nfts} />
        <Stat label="In progress" value={s.inFlight} />
        <Stat label="Operator queue" value={s.operatorQueue} hint={s.operatorQueue ? `about ${Math.ceil(s.operatorWaitSeconds / 60)} min to clear` : "clear"} />
        <Stat label="Confirmed (24h)" value={s.confirmed24h} />
        <Stat label="Failed (24h)" value={s.failed24h} hint={s.pendingWebhooks ? `${s.pendingWebhooks} app notifications waiting` : undefined} />
        <Stat label="Loop Do wallets moved in" value={s.loopDoImported} hint={s.loopDoImported && s.loopDoLastAt ? `${s.loopDoLegacy} old type (not gas-free) · last ${new Date(s.loopDoLastAt).toLocaleString()}` : "not started"} />
      </div>

      <Tabs defaultValue="log">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="log">Activity log</TabsTrigger>
          <TabsTrigger value="wallets">New wallets</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="swaps">Swaps</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="apps">Apps</TabsTrigger>
          <TabsTrigger value="import">Move wallets in</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="rounded-xl border bg-card p-4"><LinkWallet /></TabsContent>
        <TabsContent value="security" className="rounded-xl border bg-card p-4"><KeyPanel /></TabsContent>

        <TabsContent value="log" className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex gap-2 text-sm">
            {["", "queued", "submitted", "confirmed", "failed"].map((st) => (
              <Button key={st} size="sm" variant={status === st ? "default" : "outline"} onClick={() => setStatus(st)}>{st || "all"}</Button>
            ))}
          </div>
          {data.transactions.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {data.transactions.map((t) => (
            <div key={t.id} className="grid grid-cols-[1fr_auto] gap-2 border-t py-2 text-sm sm:grid-cols-[140px_160px_1fr_auto]">
              <span className="text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
              <span className="font-medium">{t.type}</span>
              <span className="text-muted-foreground">{appName(t.app_id)}{t.error_code ? ` · ${t.error_code}: ${t.error_message ?? ""}` : ""}</span>
              <span className="flex items-center gap-2">
                <span className={t.status === "failed" ? "text-destructive" : t.status === "confirmed" ? "text-primary" : "text-muted-foreground"}>{publicTransactionStatus(t.status, t.error_code)}</span>
                {t.tx_hash && <a className="underline" href={voyager("tx", t.tx_hash)} target="_blank" rel="noreferrer">view</a>}
                {publicTransactionStatus(t.status, t.error_code) === "unknown" && <Resolve id={t.id} hasHash={!!t.tx_hash} />}
              </span>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="wallets" className="rounded-xl border bg-card p-4"><NewWallets appId={appId} appName={appName} /></TabsContent>

        <TabsContent value="transfers">
          <TokenHistory tokens={data.tokens} />
        </TabsContent>
        <TabsContent value="swaps" className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">Swaps</h3>
          {data.transactions.filter((t) => t.type === "swap").length === 0 && <p className="text-sm text-muted-foreground">No swaps in the current activity results.</p>}
          {data.transactions.filter((t) => t.type === "swap").map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 border-t py-3 text-sm">
              <span className="text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
              <span className="font-medium">{appName(t.app_id)}</span>
              <span className="break-all font-mono text-xs text-muted-foreground">{short(t.tx_hash ?? t.id)}</span>
              <span className={t.status === "failed" ? "text-destructive" : t.status === "confirmed" ? "text-primary" : "text-muted-foreground"}>{publicTransactionStatus(t.status, t.error_code)}</span>
              {t.tx_hash && <a className="ml-auto underline" href={voyager("tx", t.tx_hash)} target="_blank" rel="noreferrer">View swap ↗</a>}
              {t.error_message && <p className="w-full break-words text-muted-foreground">{t.error_message}</p>}
            </div>
          ))}
        </TabsContent>
        <TabsContent value="tokens" className="rounded-xl border bg-card p-4">
          <ItemList kind="token" items={data.tokens} appName={appName} />
          <TokenHistory tokens={data.tokens} />
        </TabsContent>
        <TabsContent value="collections" className="rounded-xl border bg-card p-4">
          <ItemList kind="collection" items={data.collections} appName={appName} />
        </TabsContent>
        <TabsContent value="apps" className="space-y-4">
          {data.apps.map((a) => <AppSettings key={a.id} app={a} />)}
          {data.apps.length === 0 && <p className="text-sm text-muted-foreground">Create apps on the Admin page first.</p>}
        </TabsContent>
        <TabsContent value="import">
          <EstimateDates />
          <div className="h-4" />
          <Import apps={data.apps} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ItemList({ kind, items, appName }: { kind: "token" | "collection"; items: { id: string; app_id: string; name: string; symbol: string; address: string | null; is_test: boolean }[]; appName: (id: string) => string }) {
  const mark = useServerFn(adminMarkTest);
  const qc = useQueryClient();
  if (!items.length) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <>
      {items.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
          <span className="font-medium">{i.name} <span className="text-muted-foreground">({i.symbol})</span></span>
          <span className="text-muted-foreground">{appName(i.app_id)}</span>
          {i.address ? <a className="font-mono text-xs underline" href={voyager("contract", i.address)} target="_blank" rel="noreferrer">{short(i.address)}</a> : <span className="text-xs text-muted-foreground">being created</span>}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            test
            <Switch checked={i.is_test} onCheckedChange={async (v) => { await mark({ data: { kind, id: i.id, isTest: v } }); qc.invalidateQueries({ queryKey: ["chain-dash"] }); }} />
          </label>
        </div>
      ))}
    </>
  );
}

type TokRow = Awaited<ReturnType<typeof chainDashboard>>["tokens"][number];
const amt = (v: string) => { try { return fromBaseUnits(v); } catch { return v; } };
function TokenHistory({ tokens }: { tokens: TokRow[] }) {
  const synced = tokens.filter((t) => t.sync_enabled);
  const [id, setId] = useState("");
  const load = useServerFn(adminTokenHistory);
  const resync = useServerFn(adminResyncToken);
  const qc = useQueryClient();
  const sel = synced.find((t) => t.id === id) ?? [...synced].sort((a, b) => b.event_count - a.event_count)[0];
  const selectedId = sel?.id ?? "";
  const { data, isLoading, error } = useQuery({ queryKey: ["tok-hist", selectedId], queryFn: () => load({ data: { tokenId: selectedId } }), enabled: !!selectedId, refetchInterval: 15_000 });
  return (
    <section className="mt-6 space-y-3 border-t pt-4">
      <h3 className="font-semibold">Holders and history (from Starknet)</h3>
      {!synced.length ? <p className="text-sm text-muted-foreground">No imported tokens yet. Once Loop Do sends its token list, each token's holders and transfers are read from the chain here.</p> : (
        <>
          <select aria-label="Token transfer history" className="h-9 w-full max-w-xl rounded-md border bg-background px-2 text-sm" value={selectedId} onChange={(e) => setId(e.target.value)}>
            {synced.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.symbol}) · {t.holder_count} holders · {t.event_count} transfers</option>)}
          </select>
          {sel && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {sel.creator_ref ? `Created by ${sel.creator_ref} · ` : ""}Supply {amt(String(sel.total_supply ?? "0"))} · {sel.holder_count} holders · {sel.event_count} transfers ·{" "}
                {sel.sync_error ? <span className="text-destructive">sync problem: {sel.sync_error}</span> : sel.synced_block != null ? `History read through block ${sel.synced_block}` : "reading history…"}
              </p>
              <Button size="sm" variant="outline" onClick={async () => { try { await resync({ data: { tokenId: sel.id } }); qc.invalidateQueries({ queryKey: ["chain-dash"] }); qc.invalidateQueries({ queryKey: ["tok-hist", selectedId] }); toast.success("Re-reading from chain"); } catch { toast.error("Could not re-sync this token. Please try again."); } }}>Re-sync from chain</Button>
              {isLoading && <p className="text-muted-foreground">Loading holders and transfers…</p>}
              {error && <p className="text-destructive">Could not load holders and transfers. <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["tok-hist", selectedId] })}>Retry</Button></p>}
              {data && <Tabs defaultValue="holders">
                <TabsList>
                  <TabsTrigger value="holders">Holders</TabsTrigger>
                  <TabsTrigger value="history">Transfers</TabsTrigger>
                </TabsList>
                <TabsContent value="holders" className="min-w-0">
                  <p className="mb-1 font-medium">Holders</p>
                  {!data.holders.length && <p className="text-muted-foreground">No holders recorded yet.</p>}
                  {data?.holders.map((h) => (
                    <div key={h.address} className="flex justify-between gap-2 border-t py-1">
                      <a className="min-w-0 break-all font-mono text-xs underline" href={voyager("contract", h.address)} target="_blank" rel="noreferrer">{h.who || short(h.address)}</a>
                      <span className="shrink-0">{amt(h.balance)}</span>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history" className="min-w-0">
                  <p className="mb-1 font-medium">Transfers · latest {data.events.length}</p>
                  {!data.events.length && <p className="text-muted-foreground">No transfers recorded yet.</p>}
                  {data.events.map((e, index) => (
                    <div key={`${e.tx_hash}-${index}`} className="flex flex-wrap justify-between gap-2 border-t py-2 text-xs">
                      <span className="min-w-0 break-all">{/^0x0+$/.test(e.from_address) ? "minted" : e.fromWho || short(e.from_address)} → {/^0x0+$/.test(e.to_address) ? "burned" : e.toWho || short(e.to_address)}</span>
                      <span className="flex shrink-0 gap-2">{amt(e.amount)} <a className="underline" href={voyager("tx", e.tx_hash)} target="_blank" rel="noreferrer">#{e.block_number}</a></span>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type AppRow = Awaited<ReturnType<typeof chainDashboard>>["apps"][number];
function AppSettings({ app }: { app: AppRow }) {
  const update = useServerFn(adminUpdateAppChain);
  const qc = useQueryClient();
  const [hook, setHook] = useState(app.webhook_url ?? "");
  const [mintCap, setMintCap] = useState(app.daily_mint_cap?.toString() ?? "");
  const [distCap, setDistCap] = useState(app.daily_distribute_cap?.toString() ?? "");
  const [rate, setRate] = useState(String(app.rate_limit_per_min));
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const save = async (extra: { rotateWebhookSecret?: boolean; rotateApiKey?: boolean } = {}) => {
    try {
      const r = await update({ data: { id: app.id, webhook_url: hook || null, daily_mint_cap: mintCap ? Number(mintCap) : null, daily_distribute_cap: distCap ? Number(distCap) : null, rate_limit_per_min: Number(rate) || 60, ...extra } });
      if (r.webhookSecret) setShown({ label: "Webhook secret", value: r.webhookSecret });
      if (r.apiKey) setShown({ label: "New API key (old one stops working now)", value: r.apiKey });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["chain-dash"] });
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">{app.name}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Webhook address<Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://yourapp.com/api/wallet-events" /></label>
        <label className="text-sm">Requests per minute<Input value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label className="text-sm">Daily mint limit (tokens)<Input value={mintCap} onChange={(e) => setMintCap(e.target.value)} placeholder="no limit" /></label>
        <label className="text-sm">Daily give-out limit (tokens)<Input value={distCap} onChange={(e) => setDistCap(e.target.value)} placeholder="no limit" /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save()}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => save({ rotateWebhookSecret: true })}>New webhook secret</Button>
        <Button size="sm" variant="outline" onClick={() => { if (confirm("Issue a new API key? The current key stops working immediately.")) save({ rotateApiKey: true }); }}>New API key</Button>
      </div>
      {shown && (
        <div className="rounded-md border bg-muted p-3 text-sm">
          <p className="font-medium">{shown.label} — copy it now, it won't be shown again</p>
          <code className="break-all">{shown.value}</code>
        </div>
      )}
    </section>
  );
}

function Import({ apps }: { apps: AppRow[] }) {
  const run = useServerFn(adminImport);
  const [appId, setAppId] = useState(apps[0]?.id ?? "");
  const [mode, setMode] = useState<"new-wallets" | "tokens" | "creation-dates">("new-wallets");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<{ externalId: string; status: string; address?: string; note?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const help = {
    "new-wallets": "Columns: external_id,email,kind — e.g. Loop Fans fans. Each gets a new wallet.",
    tokens: "Columns: address,name,symbol,swappable — existing Loop Do tokens to manage from here.",
    "creation-dates": "Columns: user_id,created_at — each Loop Do user's ORIGINAL sign-up date (ISO, e.g. 2026-03-14T09:30:00Z). Only moved-in Loop Do wallets change; the Dashboard's wallet growth then shows real dates instead of the import day. Choose Loop Do as the app. Preview first.",
  }[mode];
  const go = async (dryRun: boolean) => {
    setBusy(true);
    try { const r = await run({ data: { appId, mode, csv, dryRun } }); setRows(r.rows); toast.success(dryRun ? "Preview ready" : "Imported"); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap gap-3">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={appId} onChange={(e) => setAppId(e.target.value)}>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="new-wallets">New wallets (Loop Fans etc.)</option>
          <option value="tokens">Existing tokens</option>
          <option value="creation-dates">Original sign-up dates (Loop Do)</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">{help}</p>
      <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paste CSV here, first line = column names" className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || !appId || !csv} onClick={() => go(true)}>Preview</Button>
        <Button disabled={busy || !appId || !csv} onClick={() => { if (confirm("Import these rows?")) go(false); }}>Import</Button>
      </div>
      {rows.length > 0 && (
        <div className="max-h-96 overflow-auto text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-3 border-t py-1">
              <span className="w-48 truncate">{r.externalId}</span>
              <span className={r.status === "error" || r.status === "mismatch" ? "text-destructive" : ""}>{r.status}</span>
              <span className="font-mono text-xs text-muted-foreground">{short(r.address)}</span>
              <span className="text-muted-foreground">{r.note}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LinkWallet() {
  const link = useServerFn(adminLinkImportedWallet);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(confirm: boolean) {
    setBusy(true);
    try {
      const r = await link({ data: { email, address, confirm } });
      if (!r.ok) { toast.error(r.error); setPreview(null); return; }
      if (r.preview) setPreview(r.loopDoUserId ?? "unknown");
      else { toast.success("Wallet linked. The account now uses the Loop Do wallet."); setPreview(null); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="max-w-lg space-y-3">
      <h3 className="font-semibold">Link Loop Do wallet</h3>
      <p className="text-sm text-muted-foreground">Give a hub account its moved-in Loop Do wallet. An empty hub-made wallet is retired; one holding anything is never touched.</p>
      <Input placeholder="Account email" value={email} onChange={(e) => { setEmail(e.target.value); setPreview(null); }} />
      <Input placeholder="Loop Do wallet address (0x…)" value={address} onChange={(e) => { setAddress(e.target.value); setPreview(null); }} />
      {preview ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p>Loop Do user ID: <span className="font-mono break-all">{preview}</span></p>
          <Button disabled={busy} onClick={() => run(true)}>Confirm link</Button>
        </div>
      ) : (
        <Button disabled={busy || !email || !address} onClick={() => run(false)}>Check</Button>
      )}
    </div>
  );
}

function Resolve({ id, hasHash }: { id: string; hasHash: boolean }) {
  const resolve = useServerFn(adminResolveTransaction);
  const qc = useQueryClient();
  async function go(action: "attach_hash" | "mark_failed" | "requeue") {
    let txHash: string | undefined;
    if (action === "attach_hash") {
      txHash = window.prompt("Paste the transaction hash you found on Voyager (0x…):")?.trim();
      if (!txHash) return;
    } else if (action === "mark_failed") {
      if (!window.confirm("Only do this if you checked the chain and the transaction did NOT happen. Mark it failed?")) return;
    } else if (!window.confirm("Send it again? If the first attempt actually reached the chain this will do the action twice. Check Voyager first.")) return;
    const r = await resolve({ data: { id, action, ...(txHash ? { txHash } : {}) } }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    if (r.ok) { toast.success("Updated"); void qc.invalidateQueries({ queryKey: ["chain-dash"] }); } else toast.error(r.error);
  }
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="outline" onClick={() => go("attach_hash")}>Found on chain</Button>
      <Button size="sm" variant="outline" onClick={() => go("mark_failed")}>Didn't happen</Button>
      {!hasHash && <Button size="sm" variant="outline" onClick={() => go("requeue")}>Send again</Button>}
    </span>
  );
}

function KeyPanel() {
  const status = useServerFn(adminKeyStatus);
  const rotate = useServerFn(adminRotateKeys);
  const { data, refetch } = useQuery({ queryKey: ["key-status"], queryFn: () => status(), retry: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await rotate({ data: { dryRun } });
      if (!r.ok) { toast.error(r.error); return; }
      setNote(`${dryRun ? "Checked" : "Re-encrypted"} ${r.rotated} wallet(s)${r.failed ? `, ${r.failed} failed: ${r.errors.join(" | ")}` : ""}. ${r.remaining} left.`);
      void refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.ok) return <p className="text-sm text-destructive">{data.error}</p>;
  return (
    <div className="max-w-2xl space-y-3 text-sm">
      <h3 className="font-semibold">Wallet encryption key</h3>
      <p className="text-muted-foreground">Every wallet's private key is encrypted with one key. Losing that key loses all funds, so it must be stored somewhere you control (a password manager) and not only in the app's secrets, which cannot be read back.</p>
      <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
        <span>Key in use</span><span className="font-mono">{data.currentKeyId}</span>
        <span>New key (WALLET_ENCRYPTION_KEY_NEXT)</span><span className="font-mono">{data.nextKeyId ?? "not set"}</span>
        <span>Wallets</span><span>{data.wallets}</span>
        <span>Encrypted with the target key</span><span>{data.onTargetKey} of {data.wallets}</span>
      </div>
      {data.nextConfigured ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => run(true)}>Check (no changes)</Button>
            <Button disabled={busy || data.remaining === 0} onClick={() => run(false)}>{data.remaining === 0 ? "All wallets on the new key" : "Re-encrypt next 200"}</Button>
          </div>
          {data.remaining === 0 && <p className="text-muted-foreground">Done. Now set WALLET_ENCRYPTION_KEY to the new key's value and delete WALLET_ENCRYPTION_KEY_NEXT.</p>}
        </div>
      ) : (
        <p className="text-muted-foreground">To move onto a key you hold: generate a 64-character random key, store it in your password manager, then add it as the secret WALLET_ENCRYPTION_KEY_NEXT and reload this page.</p>
      )}
      {note && <p>{note}</p>}
    </div>
  );
}

function NewWallets({ appId, appName }: { appId: string; appName: (id: string) => string }) {
  const fetchWallets = useServerFn(adminNewWallets);
  const { data, isLoading, error } = useQuery({ queryKey: ["new-wallets", appId], queryFn: () => fetchWallets({ data: { appId: appId || null } }), refetchInterval: 15_000, retry: false });
  void appName;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Could not load wallets.</p>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Created in the last 24 hours</p><p className="text-2xl font-semibold">{data.counts.last24h}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Last 7 days</p><p className="text-2xl font-semibold">{data.counts.last7d}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">All wallets</p><p className="text-2xl font-semibold">{data.counts.total}</p></div>
      </div>
      <p className="text-xs text-muted-foreground">Newest first, latest 300. Updates every 15 seconds. The app filter above applies.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Created</th><th className="pr-3">Who</th><th className="pr-3">From</th><th className="pr-3">Wallet</th><th className="pr-3">Status</th></tr></thead>
          <tbody>
            {data.wallets.map((w) => (
              <tr key={w.id} className="border-t align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{new Date(w.createdAt).toLocaleString()}</td>
                <td className="pr-3">{w.email ?? (w.externalId ? `user ${w.externalId}` : "–")}</td>
                <td className="pr-3">{w.app ?? w.source}<span className="block text-xs text-muted-foreground">{w.source}{w.kind !== "user" ? ` · ${w.kind}` : ""}</span></td>
                <td className="pr-3"><a className="font-mono text-xs underline" href={voyager("contract", w.address)} target="_blank" rel="noreferrer">{short(w.address)}</a></td>
                <td className="pr-3 text-xs"><span className={w.deployed ? "text-primary" : "text-muted-foreground"}>{w.deployed ? "deployed" : "not yet deployed"}</span><span className="block text-muted-foreground">email {w.emailVerified ? "verified" : "unverified"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.wallets.length === 0 && <p className="py-4 text-sm text-muted-foreground">No wallets yet.</p>}
      </div>
    </div>
  );
}

function EstimateDates() {
  const run = useServerFn(adminEstimateWalletDates);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Awaited<ReturnType<typeof adminEstimateWalletDates>> | null>(null);
  async function go(dryRun: boolean) {
    if (!dryRun && !window.confirm("Change the creation date of these wallets to the estimates? Real dates from a Loop Do export are never overwritten, and you can load an export later to correct any of them.")) return;
    setBusy(true);
    try {
      const x = await run({ data: { dryRun } });
      setR(x);
      if (!x.ok) toast.error(x.error); else { toast.success(dryRun ? "Preview ready" : `Updated ${x.updated} wallets`); if (!dryRun) void qc.invalidateQueries({ queryKey: ["public-stats"] }); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">Estimate sign-up dates from first on-chain activity</h3>
      <p className="text-sm text-muted-foreground">Moved-in Loop Do wallets all show the import day. This dates each one by its first transfer in or out of the wallet on Starknet. It is an estimate (the day the wallet first held or sent something, not the day the person signed up). Wallets with no activity are left alone, and real dates from an export are never overwritten.</p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => go(true)}>Preview</Button>
        <Button disabled={busy || !r || !r.ok || !r.dryRun || !r.wouldUpdate} onClick={() => go(false)}>Apply estimates</Button>
      </div>
      {r && !r.ok && <p className="text-sm text-destructive">{r.error}</p>}
      {r && r.ok && (
        <div className="space-y-2 text-sm">
          <p>{r.importedTotal} moved-in wallets · {r.withActivity} have on-chain activity · {r.noActivity} have none · {r.alreadyDated} already have a real date.</p>
          <p>{r.dryRun ? `Would update ${r.wouldUpdate} wallets` : `Updated ${r.updated} wallets`}{r.earliest ? `, spread from ${r.earliest} to ${r.latest}.` : "."}{!r.complete && " Some block times could not be read yet; run again."}</p>
          {r.byDay.length > 0 && <p className="font-mono text-xs text-muted-foreground">{r.byDay.slice(0, 14).map((d) => `${d.day.slice(5)}: ${d.n}`).join("  ·  ")}{r.byDay.length > 14 ? "  …" : ""}</p>}
        </div>
      )}
    </section>
  );
}
