import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sha256Hex } from "@/lib/wallet/crypto";

const Body = z.object({
  source: z.literal("loop-do"),
  dry_run: z.boolean().optional(),
  wallets: z.array(z.object({
    user_id: z.string().min(1).max(200), address: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
    email: z.string().email().max(254), email_verified: z.boolean(),
  })).min(1).max(200),
});

// Loop Do sends verified emails for wallets it already moved in. Auth: Bearer LOOP_WALLET_MIGRATION_KEY.
export const Route = createFileRoute("/api/public/migrate/wallets/emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["LOOP_WALLET_MIGRATION_KEY"];
        const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!expected || !got || (await sha256Hex(got)) !== (await sha256Hex(expected))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "bad request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
        try {
          const { attachLoopDoEmails } = await import("@/lib/wallet/service.server");
          const results = await attachLoopDoEmails(parsed.data.wallets, !!parsed.data.dry_run);
          const counts: Record<string, number> = {};
          for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
          return Response.json({ dry_run: !!parsed.data.dry_run, counts, results });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
