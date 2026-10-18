import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { disconnect, TelegramConnectInput } from "@/server/services/integrations";
import { connectTelegramBot } from "@/server/services/messaging";

export const PUT = route(async (req) => {
  const actor = await requireActor();
  return json(await connectTelegramBot(actor, await readJson(req, TelegramConnectInput)));
});
export const DELETE = route(async () => {
  const actor = await requireActor();
  await disconnect(actor, "telegram");
  return json({ ok: true });
});
