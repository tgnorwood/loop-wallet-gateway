import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { emailSchema, handle, legacyEndpointGate, preflight } from "@/lib/wallet/http";

const schema = z.object({ email: emailSchema });

export const Route = createFileRoute("/api/public/v1/wallet/get-or-create")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: handle(schema, async ({ body, app, ip, ua }) => {
        await legacyEndpointGate(app, "POST /v1/wallet/get-or-create", ip);
        const svc = await import("@/lib/wallet/service.server");
        return svc.getOrCreate(app!, body, ip, ua);
      }),
    },
  },
});
