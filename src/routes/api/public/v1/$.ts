import { createFileRoute } from "@tanstack/react-router";

// Central wallet API v1: /api/public/v1/wallets, /tokens, /transfers, /collections, /nft-transfers, /transactions ...
// Auth (Bearer app key) is checked inside dispatchV1 before anything else runs.
async function run({ request, params }: { request: Request; params: unknown }) {
  const { dispatchV1 } = await import("@/lib/wallet/api-v1.server");
  return dispatchV1(request, (params as { _splat?: string })._splat ?? "");
}

export const Route = createFileRoute("/api/public/v1/$")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/wallet/api-v1.server")).preflightV1(),
      GET: run,
      POST: run,
      PATCH: run,
      DELETE: run,
    },
  },
});
