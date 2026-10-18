import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listIntegrations } from "@/server/services/integrations";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ integrations: await listIntegrations(actor) });
});
