import { z } from "zod";

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-app-key,authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

type Ctx = { req: Request; ip: string | null; ua: string | null; origin: string | null };

/**
 * Wraps a partner API handler: JSON errors, CORS. When `requireKey` is set, loads the app
 * from X-App-Key and rejects browser origins not registered for that app.
 */
export function handle<T>(
  schema: z.ZodType<T> | null,
  fn: (ctx: Ctx & { body: T; app: Awaited<ReturnType<typeof import("./service.server").appFromKey>> | null }) => Promise<unknown>,
  opts: { requireKey?: boolean } = { requireKey: true },
) {
  return async ({ request }: { request: Request }) => {
    const origin = request.headers.get("origin");
    const svc = await import("./service.server");
    const { isOriginAllowed } = await import("./rules");
    try {
      let app = null;
      if (opts.requireKey !== false) {
        app = await svc.appFromKey(request.headers.get("x-app-key"));
        if (origin && !isOriginAllowed(origin, app.allowed_origins)) {
          throw new svc.ApiError(403, "origin_not_allowed");
        }
      }
      let body = undefined as T;
      if (schema) {
        const raw = request.method === "GET" ? {} : await request.json().catch(() => ({}));
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new svc.ApiError(400, "invalid_input", parsed.error.issues[0]?.message);
        body = parsed.data;
      }
      const result = await fn({ req: request, ip: clientIp(request), ua: request.headers.get("user-agent"), origin, body, app });
      return Response.json(result, { headers: corsHeaders(origin) });
    } catch (e) {
      if (e instanceof svc.ApiError) {
        return Response.json({ error: e.code, message: e.message, ...e.extra }, { status: e.status, headers: corsHeaders(origin) });
      }
      console.error(e);
      return Response.json({ error: "server_error" }, { status: 500, headers: corsHeaders(origin) });
    }
  };
}

export const emailSchema = z.string().trim().email().max(254);

/**
 * The email-only endpoints (/wallet/get-or-create, verify-otp, resend-otp) are retired in favour of
 * POST /api/public/v1/wallets. They answer 410 and log which app called, unless LEGACY_WALLET_API=on.
 */
export async function legacyEndpointGate(app: { id: string } | null, endpoint: string, ip: string | null) {
  if (process.env["LEGACY_WALLET_API"] === "on") return;
  const svc = await import("./service.server");
  await svc.audit({ app_id: app?.id ?? null, action: "legacy_endpoint_called", method: endpoint, ip });
  throw new svc.ApiError(410, "endpoint_retired", "This endpoint is retired. Use POST /api/public/v1/wallets (then POST /api/public/v1/wallets/verify) with your app key in an Authorization: Bearer header from your server.");
}
