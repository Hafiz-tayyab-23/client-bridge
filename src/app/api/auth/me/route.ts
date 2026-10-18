import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { me } from "@/server/services/accounts";
import { sql } from "@/server/db";

export const GET = route(async () => {
  const actor = await requireActor();
  const [ws] = await sql`select id, name, timezone from workspaces where id = ${actor.workspaceId}`;
  return json({ user: me(actor), workspace: ws });
});
