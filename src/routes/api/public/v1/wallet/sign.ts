import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handle, preflight } from "@/lib/wallet/http";

const schema = z.object({
  session_token: z.string().min(10).max(200),
  typed_data: z.object({
    types: z.record(z.string(), z.any()),
    primaryType: z.string(),
    domain: z.record(z.string(), z.any()),
    message: z.record(z.string(), z.any()),
  }),
});

export const Route = createFileRoute("/api/public/v1/wallet/sign")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip }) => {
        const svc = await import("@/lib/wallet/service.server");
        const { wallet, session } = await svc.walletFromSession(body.session_token);
        if (session.app_id && session.app_id !== app!.id) throw new svc.ApiError(403, "session_not_for_this_app");
        return svc.signWithWallet(wallet.id, app!.id, body.typed_data, ip);
      }),
    },
  },
});
