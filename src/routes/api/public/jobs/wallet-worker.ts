import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Called every minute by the scheduler: confirms submitted txs, submits the next per signer, sends webhooks.
export const Route = createFileRoute("/api/public/jobs/wallet-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { tick } = await import("@/lib/wallet/engine.server");
        const stats = await tick({ maxClaims: 10, budgetMs: 20_000 });
        let history = {};
        try { const { syncTokens } = await import("@/lib/wallet/token-sync.server"); history = await syncTokens(10_000); } catch (e) { history = { error: (e as Error).message }; }
        return Response.json({ ok: true, ...stats, history });
      },
    },
  },
});
