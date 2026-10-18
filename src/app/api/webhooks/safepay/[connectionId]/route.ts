import { route, json, parseId } from "@/server/http";
import { handleSafepayWebhook } from "@/server/services/safepay-payments";

// Safepay → us. Raw body needed for X-SFPY-SIGNATURE (HMAC-SHA512) verification; server-to-server, no CSRF.
export const POST = route(async (req, ctx: RouteContext<"/api/webhooks/safepay/[connectionId]">) => {
  const id = parseId((await ctx.params).connectionId);
  return json(await handleSafepayWebhook(id, await req.text(), req.headers.get("x-sfpy-signature")));
}, { csrf: false });
