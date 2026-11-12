import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminResolveTransaction } from "@/lib/wallet/chain-admin.functions";

/** Buttons for a transaction whose outcome is unknown. It holds up its queue until an admin decides. */
export function Resolve({ id, hasHash }: { id: string; hasHash: boolean }) {
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
    if (r.ok) { toast.success("Updated"); void qc.invalidateQueries({ queryKey: ["chain-dash"] }); void qc.invalidateQueries({ queryKey: ["admin-issues"] }); } else toast.error(r.error);
  }
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="outline" onClick={() => go("attach_hash")}>Found on chain</Button>
      <Button size="sm" variant="outline" onClick={() => go("mark_failed")}>Didn't happen</Button>
      {!hasHash && <Button size="sm" variant="outline" onClick={() => go("requeue")}>Send again</Button>}
    </span>
  );
}

