import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { recoveryQueue } from "@/server/services/leads";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ items: await recoveryQueue(actor) });
});
