import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { emailSchema, handle, preflight } from "@/lib/wallet/http";

const schema = z.object({ email: emailSchema });

export const Route = createFileRoute("/api/public/v1/wallet/resend-otp")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip }) => {
        const svc = await import("@/lib/wallet/service.server");
        return svc.resendOtp(app!, body.email, ip);
      }),
    },
  },
});
