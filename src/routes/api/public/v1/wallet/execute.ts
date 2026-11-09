import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handle, preflight } from "@/lib/wallet/http";
import { callsSchema } from "@/lib/wallet/calls-schema";

const schema = z.object({ session_token: z.string().min(10).max(200), calls: callsSchema });

// Gas-free execution: first call deploys the account + runs calls in one sponsored tx.
export const Route = createFileRoute("/api/public/v1/wallet/execute")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip }) => {
        const svc = await import("@/lib/wallet/service.server");
        const { wallet, session } = await svc.walletFromSession(body.session_token);
        if (session.app_id && session.app_id !== app!.id) throw new svc.ApiError(403, "session_not_for_this_app");
        return svc.executeForWallet(wallet.id, app!.id, body.calls, ip);
      }),
    },
  },
});
