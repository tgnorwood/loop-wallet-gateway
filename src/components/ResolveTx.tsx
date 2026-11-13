import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { adminCheckOnChain, adminResolveTransaction } from "@/lib/wallet/chain-admin.functions";

/** Buttons for a transaction whose outcome is unknown. It holds up its queue until an admin decides. */
export function Resolve({ id, hasHash }: { id: string; hasHash: boolean }) {
  const resolve = useServerFn(adminResolveTransaction);
  const check = useServerFn(adminCheckOnChain);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "pass" | "wait" | "fail"; text: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["chain-dash"] }); void qc.invalidateQueries({ queryKey: ["admin-issues"] }); };

  async function checkChain() {
    setBusy(true); setNote(null);
    try {
      const r = await check({ data: { id } });
      if (!r.ok) { setNote({ tone: "fail", text: r.error }); return; }
      const tone = r.result === "found" ? "pass" : r.result === "not_found" ? "fail" : "wait";
      setNote({ tone, text: r.message });
      if (r.result === "found" || r.result === "not_found" || r.result === "skipped") refresh();
    } catch (e) { setNote({ tone: "fail", text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function manual(action: "attach_hash" | "mark_failed" | "requeue") {
    let txHash: string | undefined;
    if (action === "attach_hash") {
      txHash = window.prompt("Paste the transaction hash you found on Voyager (0x…):")?.trim();
      if (!txHash) return;
    } else if (action === "mark_failed") {
      if (!window.confirm("Only do this if you checked the chain and the transaction did NOT happen. Mark it failed?")) return;
    } else if (!window.confirm("Send it again? If the first attempt actually reached the chain this will do the action twice. Run Check on chain first.")) return;
    const r = await resolve({ data: { id, action, ...(txHash ? { txHash } : {}) } }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    if (r.ok) { toast.success("Updated"); refresh(); } else toast.error(r.error);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={busy} onClick={checkChain}>{busy ? "Checking…" : "Check on chain"}</Button>
        <Button size="sm" variant="ghost" onClick={() => manual("attach_hash")}>Enter hash</Button>
        <Button size="sm" variant="ghost" onClick={() => manual("mark_failed")}>Didn't happen</Button>
        {!hasHash && <Button size="sm" variant="ghost" onClick={() => manual("requeue")}>Send again</Button>}
      </div>
      {note && <p className={`max-w-md text-xs ${note.tone === "pass" ? "text-emerald-400" : note.tone === "fail" ? "text-destructive" : "text-amber-400"}`}>{note.tone === "pass" ? "PASSED. " : note.tone === "fail" ? "FAILED. " : "NOT YET. "}{note.text}</p>}
    </div>
  );
}
