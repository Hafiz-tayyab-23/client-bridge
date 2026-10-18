import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { connectStripe, disconnect, StripeConnectInput } from "@/server/services/integrations";

export const PUT = route(async (req) => {
  const actor = await requireActor();
  return json(await connectStripe(actor, await readJson(req, StripeConnectInput)));
});
export const DELETE = route(async () => {
  const actor = await requireActor();
  await disconnect(actor, "stripe");
  return json({ ok: true });
});
