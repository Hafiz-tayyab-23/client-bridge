import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { connectSafepay, disconnectSafepay, SafepayConnectInput } from "@/server/services/safepay-payments";

export const PUT = route(async (req) => {
  const actor = await requireActor();
  return json(await connectSafepay(actor, await readJson(req, SafepayConnectInput)));
});
export const DELETE = route(async () => {
  const actor = await requireActor();
  await disconnectSafepay(actor);
  return json({ ok: true });
});
