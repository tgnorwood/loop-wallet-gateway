import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { emailSchema, handle, legacyEndpointGate, preflight } from "@/lib/wallet/http";

const schema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) });

export const Route = createFileRoute("/api/public/v1/wallet/verify-otp")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip, ua }) => {
        await legacyEndpointGate(app, "POST /v1/wallet/verify-otp", ip);
        const svc = await import("@/lib/wallet/service.server");
        const { normalizeEmail } = await import("@/lib/wallet/rules");
        await svc.rateLimit(`otp:${normalizeEmail(body.email)}`, 10, 10 * 60_000);
        if (ip) await svc.rateLimit(`otp-ip:${ip}`, 30, 10 * 60_000);
        return svc.verifyOtp(app!, body.email, body.code, ip, ua);
      }),
    },
  },
});
