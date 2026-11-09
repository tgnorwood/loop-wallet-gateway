import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { emailSchema, handle, preflight } from "@/lib/wallet/http";

const schema = z.object({ email: emailSchema, oauth_verified: z.boolean().optional() });

export const Route = createFileRoute("/api/public/v1/wallet/get-or-create")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip, ua }) => {
        const svc = await import("@/lib/wallet/service.server");
        return svc.getOrCreate(app!, body, ip, ua);
      }),
    },
  },
});
