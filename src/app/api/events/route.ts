import { after } from "next/server";
import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listMyNotifications } from "@/server/services/notifications";
import { runTick } from "@/server/worker";

// Realtime poll (Q11): the UI calls this every few seconds for new notifications.
// It also nudges the worker as a backup trigger in case the scheduled tick is delayed.
export const GET = route(async (req) => {
  const actor = await requireActor();
  after(() => runTick(3).catch((e) => console.error("tick failed", e)));
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  const sinceOk = since && !Number.isNaN(Date.parse(since)) ? since : undefined;
  return json({ notifications: await listMyNotifications(actor, sinceOk), serverTime: new Date().toISOString() });
});
