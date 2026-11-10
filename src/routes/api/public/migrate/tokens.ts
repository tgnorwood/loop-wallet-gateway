import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sha256Hex } from "@/lib/wallet/crypto";

const Body = z.object({
  source: z.literal("loop-do"),
  dry_run: z.boolean().optional(),
  tokens: z.array(z.object({
    address: z.string().min(3).max(80), name: z.string().min(1).max(100), symbol: z.string().min(1).max(20),
    creator_user_id: z.string().max(200).optional(), creator_email: z.string().max(200).optional(), swappable: z.boolean().optional(),
  }).passthrough()).min(1).max(200),
});

// Loop Do pushes its token list. Auth: Bearer LOOP_WALLET_MIGRATION_KEY. History/holders are then read from chain.
export const Route = createFileRoute("/api/public/migrate/tokens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["LOOP_WALLET_MIGRATION_KEY"];
        const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!expected || !got || (await sha256Hex(got)) !== (await sha256Hex(expected))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "bad request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
        try {
          const { receiveLoopDoTokens } = await import("@/lib/wallet/token-sync.server");
          const results = await receiveLoopDoTokens(parsed.data.tokens, !!parsed.data.dry_run);
          const c = (s: string) => results.filter((r) => r.status === s).length;
          return Response.json({ dry_run: !!parsed.data.dry_run, created: c("created"), would_create: c("would_create"), exists: c("exists"), errors: c("error"), results });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
