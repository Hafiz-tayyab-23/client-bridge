import { route, json, parseId } from "@/server/http";
import { handleStripeWebhook } from "@/server/services/payments";

// Stripe → us. Raw body is required for signature verification; no session/CSRF (server-to-server).
export const POST = route(async (req, ctx: RouteContext<"/api/webhooks/stripe/[connectionId]">) => {
  const id = parseId((await ctx.params).connectionId);
  const raw = await req.text();
  return json(await handleStripeWebhook(id, raw, req.headers.get("stripe-signature")));
}, { csrf: false });
