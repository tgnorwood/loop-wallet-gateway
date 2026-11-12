import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { adminIssues } from "@/lib/wallet/chain-admin.functions";
import { Resolve } from "@/components/ResolveTx";

export function useIssues() {
  const fetchIssues = useServerFn(adminIssues);
  return useQuery({ queryKey: ["admin-issues"], queryFn: () => fetchIssues(), refetchInterval: 20_000, retry: false });
}

type Issues = NonNullable<ReturnType<typeof useIssues>["data"]>;
const voyager = (h: string) => `https://sepolia.voyager.online/tx/${h}`;
const when = (iso: string) => new Date(iso).toLocaleString();
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };

/** Summary strip for the top of the Admin page: all clear, or how many things need attention. */
export function IssuesBanner() {
  const { data, error } = useIssues();
  if (error || !data) return null;
  const clear = data.issueCount === 0;
  return (
    <a href="#admin-console" className={`flex items-center gap-3 rounded-xl border p-4 text-sm transition-colors hover:bg-secondary ${clear ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      {clear ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
      <span className="font-medium">{clear ? "No issues right now" : `${data.issueCount} thing${data.issueCount === 1 ? "" : "s"} need${data.issueCount === 1 ? "s" : ""} attention`}</span>
      <span className="text-muted-foreground">{clear ? "Transactions, wallets and notifications look healthy." : "Open the Issues tab below."}</span>
      <span className="ml-auto text-xs text-muted-foreground">Updated {new Date(data.asOf).toLocaleTimeString()}</span>
    </a>
  );
}

function Section({ title, hint, count, tone = "bad", children }: { title: string; hint: string; count: number; tone?: "bad" | "warn" | "info"; children: React.ReactNode }) {
  const color = count === 0 ? "text-emerald-400" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-400" : "text-muted-foreground";
  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-center gap-2">
        {count === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className={`h-4 w-4 ${color}`} />}
        <h4 className="font-semibold">{title}</h4>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${color}`}>{count === 0 ? "all clear" : count}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {count > 0 && <div className="mt-3 divide-y text-sm">{children}</div>}
    </section>
  );
}

function TxRow({ t, resolve }: { t: Issues["failed"][number]; resolve?: boolean }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[150px_1fr_auto]">
      <span className="text-muted-foreground">{when(t.createdAt)}<span className="block text-xs">{ago(t.createdAt)} ago</span></span>
      <span>
        <span className="font-medium">{t.type}</span> <span className="text-muted-foreground">· {t.app}{t.who ? ` · ${t.who}` : ""}</span>
        {(t.errorCode || t.errorMessage) && <span className="block break-words text-xs text-destructive">{[t.errorCode, t.errorMessage].filter(Boolean).join(": ")}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {t.txHash && <a className="text-xs underline" href={voyager(t.txHash)} target="_blank" rel="noreferrer">Voyager ↗</a>}
        {resolve && <Resolve id={t.id} hasHash={!!t.txHash} />}
      </span>
    </div>
  );
}

export function IssuesPanel() {
  const { data, isLoading, error } = useIssues();
  if (isLoading) return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Could not load the issues list.</p>;
  return <IssuesView data={data} />;
}

export function IssuesView({ data }: { data: Issues }) {
  const codes = Object.entries(data.failedByCode).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Everything that may need a human, newest problems first. Refreshes every 20 seconds. A section turns green when there is nothing to do.</p>

      <Section title="Outcome unknown" count={data.unknown.length} hint="We sent it but never heard back. It holds up everything behind it in the same queue until you decide. Check Voyager, then choose.">
        {data.unknown.map((t) => <TxRow key={t.id} t={t} resolve />)}
      </Section>

      <Section title="Stuck in the queue" count={data.stuckQueued.length + data.stuckSubmitted.length} tone="warn" hint="Waiting more than 10 minutes to start, or sent more than 5 minutes ago with no confirmation. Usually clears itself; if it does not, the relay, the paymaster or the RPC may be down.">
        {[...data.stuckQueued, ...data.stuckSubmitted].map((t) => <TxRow key={t.id} t={{ ...t, errorCode: null, errorMessage: t.status === "queued" ? "waiting to start" : "sent, no confirmation yet", who: null }} />)}
      </Section>

      <Section title="Failed transactions" count={data.failed.length} hint="The last 7 days. Insufficient balance, a rejected call or a legacy wallet type are usually the user's side; the same error repeating across many people points at a bug.">
        {codes.length > 0 && <div className="flex flex-wrap gap-2 py-2 text-xs">{codes.map(([c, n]) => <span key={c} className="rounded-full border px-2 py-0.5">{c} × {n}</span>)}</div>}
        {data.failed.slice(0, 40).map((t) => <TxRow key={t.id} t={t} />)}
        {data.failed.length > 40 && <p className="py-2 text-xs text-muted-foreground">Showing the latest 40 of {data.failed.length}. The Activity log has the full list (filter: failed).</p>}
      </Section>

      <Section title="Server errors on wallet and transaction requests" count={data.apiErrors.length} hint="Requests our own server failed to handle in the last 24 hours (including wallet creation). Not the caller's mistake, so these are worth fixing.">
        {data.apiErrors.map((e, i) => (
          <div key={i} className="py-2"><span className="text-muted-foreground">{when(e.createdAt)}</span> · <span className="font-mono text-xs">{e.endpoint}</span> · {e.app}<span className="block break-words text-xs text-destructive">{[e.code, e.message].filter(Boolean).join(": ")}</span></div>
        ))}
      </Section>

      <Section title="Notifications to apps not getting through" count={data.webhooks.length} tone="warn" hint="Our messages to an app (transaction confirmed or failed) keep failing. The app's webhook address may be wrong or down. We keep retrying for 24 hours.">
        {data.webhooks.map((h) => (
          <div key={h.id} className="py-2"><span className="text-muted-foreground">{when(h.createdAt)}</span> · {h.app} · {h.event} · {h.attempts} tries · {h.status}{h.lastError && <span className="block text-xs text-destructive">{h.lastError}</span>}</div>
        ))}
      </Section>

      <Section title="Many wrong email codes" count={data.wrongCodes.length} tone="warn" hint="Five or more wrong 6-digit codes on one wallet in the last 24 hours. Could be someone guessing, or a real person with a bad inbox.">
        {data.wrongCodes.map((w, i) => <div key={i} className="py-2">{w.who} <span className="text-muted-foreground">· {w.attempts} wrong codes</span></div>)}
      </Section>

      <Section title="Apps still using retired endpoints" count={data.legacyCalls.length} tone="warn" hint="These calls get a 410 error. The app needs the new wallet API (see the services guide). The list empties once every app is updated.">
        {data.legacyCalls.map((l, i) => <div key={i} className="py-2">{l.app} · <span className="font-mono text-xs">{l.endpoint}</span> <span className="text-muted-foreground">· {l.n} calls, last {ago(l.last)} ago</span></div>)}
      </Section>

      <Section title="Tokens that cannot sync" count={data.tokenSyncErrors.length} tone="warn" hint="Holders and transfers for these tokens may be out of date. Usually a busy network node; open the Tokens tab and press Resync.">
        {data.tokenSyncErrors.map((t, i) => <div key={i} className="py-2"><span className="font-medium">{t.name}</span> {t.symbol}<span className="block break-words text-xs text-destructive">{t.error}</span></div>)}
      </Section>
    </div>
  );
}
