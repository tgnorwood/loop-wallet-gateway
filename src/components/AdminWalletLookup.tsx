import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminOverview, adminRevokeSessions, adminSearch } from "@/lib/wallet/portal.functions";

/** Look up one wallet by email or address (full history, end its sessions) and see recent takeovers. */
export function WalletLookup() {
  const overview = useServerFn(adminOverview);
  const { data } = useQuery({ queryKey: ["admin"], queryFn: () => overview(), retry: false });
  const takeovers = data?.takeovers ?? [];
  return (
    <div className="space-y-6">
      <Search />
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Recent takeovers</h2>
        {takeovers.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {takeovers.map((t) => (
          <div key={t.id} className="flex justify-between border-t py-2 text-sm">
            <span>{(t.wallets as { email: string } | null)?.email}</span>
            <span className="text-muted-foreground">{t.method} · {t.ip ?? "—"} · {new Date(t.created_at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </div>
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
