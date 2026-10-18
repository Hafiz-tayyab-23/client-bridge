import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { disconnectGoogle } from "@/server/services/calendar";

// DELETE /api/integrations/google?userId=<id> (own connection, or any with integrations.manage)
export const DELETE = route(async (req) => {
  const actor = await requireActor();
  const uid = req.nextUrl.searchParams.get("userId");
  await disconnectGoogle(actor, uid ? parseId(uid) : actor.id);
  return json({ ok: true });
});
