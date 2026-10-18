import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { dashboard } from "@/server/services/dashboard";

export const GET = route(async () => {
  const actor = await requireActor();
  return json(await dashboard(actor));
});
