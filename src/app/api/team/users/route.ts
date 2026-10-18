import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listUsers } from "@/server/services/team";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ users: await listUsers(actor) });
});
