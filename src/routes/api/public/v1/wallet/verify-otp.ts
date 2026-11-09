import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { emailSchema, handle, preflight } from "@/lib/wallet/http";

const schema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) });

export const Route = createFileRoute("/api/public/v1/wallet/verify-otp")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip, ua }) => {
        const svc = await import("@/lib/wallet/service.server");
        await svc.rateLimit(`otp:${body.email}`, 10, 10 * 60_000);
        return svc.verifyOtp(app!, body.email, body.code, ip, ua);
      }),
    },
  },
});
