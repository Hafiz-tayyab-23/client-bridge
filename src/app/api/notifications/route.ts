import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listMyNotifications, markRead } from "@/server/services/notifications";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ notifications: await listMyNotifications(actor) });
});

export const POST = route(async () => {
  const actor = await requireActor();
  await markRead(actor);
  return json({ ok: true });
});
