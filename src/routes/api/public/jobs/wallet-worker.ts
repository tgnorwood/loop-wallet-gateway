import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Called every minute by the scheduler: confirms submitted txs, submits the next per signer, sends webhooks.
export const Route = createFileRoute("/api/public/jobs/wallet-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { drain } = await import("@/lib/wallet/engine.server");
        // Keeps cycling for most of the minute so lanes turn over every few seconds instead of once a minute.
        const stats = await drain({ budgetMs: 38_000 });
        let history = {};
        try { const { syncTokens } = await import("@/lib/wallet/token-sync.server"); history = await syncTokens(8_000); } catch (e) { history = { error: (e as Error).message }; }
        return Response.json({ ok: true, ...stats, history });
      },
    },
  },
});
