import { createFileRoute } from "@tanstack/react-router";
import { sha256Hex } from "@/lib/wallet/crypto";

// Receives Loop Do's one-time wallet push. Auth: Bearer LOOP_WALLET_MIGRATION_KEY.
export const Route = createFileRoute("/api/public/migrate/wallets/migrate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["LOOP_WALLET_MIGRATION_KEY"];
        const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!expected || !got || (await sha256Hex(got)) !== (await sha256Hex(expected))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as { source?: string; wallets?: unknown[] } | null;
        if (body?.source !== "loop-do" || !Array.isArray(body.wallets) || body.wallets.length > 200) return Response.json({ error: "bad request" }, { status: 400 });
        try {
          const { receiveLoopDoWallets } = await import("@/lib/wallet/migrate.server");
          const results = await receiveLoopDoWallets(body.wallets as never);
          const c = (s: string) => results.filter((r) => r.status === s).length;
          return Response.json({ created: c("created"), exists: c("exists"), mismatch: c("mismatch"), errors: c("error"), results });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
