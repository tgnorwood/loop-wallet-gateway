import { createFileRoute } from "@tanstack/react-router";
import { handle, preflight } from "@/lib/wallet/http";

export const Route = createFileRoute("/api/public/v1/wallet/$address/assets")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      GET: async (ctx) => {
        const address = (ctx.params as { address: string }).address;
        return handle(null, async () => {
          const { isValidAddress } = await import("@/lib/wallet/starknet");
          const svc = await import("@/lib/wallet/service.server");
          if (!isValidAddress(address)) throw new svc.ApiError(400, "invalid_address");
          return svc.getAssets(address);
        })(ctx);
      },
    },
  },
});
