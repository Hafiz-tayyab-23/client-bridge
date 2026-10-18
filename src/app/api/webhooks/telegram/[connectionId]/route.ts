import { route, json, parseId } from "@/server/http";
import { handleTelegramWebhook } from "@/server/services/messaging";

// Telegram → us. Authenticated by the per-workspace secret token header (Telegram does not sign bodies).
export const POST = route(async (req, ctx: RouteContext<"/api/webhooks/telegram/[connectionId]">) => {
  const id = parseId((await ctx.params).connectionId);
  return json(await handleTelegramWebhook(id, req.headers.get("x-telegram-bot-api-secret-token"), await req.text()));
}, { csrf: false });
