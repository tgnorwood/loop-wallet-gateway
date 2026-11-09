import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handle, preflight } from "@/lib/wallet/http";

const schema = z.object({ code: z.string().min(10).max(200), code_verifier: z.string().min(43).max(128) });

// Exchanges a popup authorization code (PKCE) for a wallet session token.
export const Route = createFileRoute("/api/public/v1/oauth/token")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(
        schema,
        async ({ body, ip, ua }) => {
          const svc = await import("@/lib/wallet/service.server");
          await svc.rateLimit(`tok:${ip}`, 30, 60_000);
          return svc.exchangeCode(body.code, body.code_verifier, ip, ua);
        },
        { requireKey: false },
      ),
    },
  },
});
