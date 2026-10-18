import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { calendarStatus, listAppointments } from "@/server/services/calendar";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  const [status, appointments] = await Promise.all([calendarStatus(actor), listAppointments(actor, { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined })]);
  return json({ ...status, appointments });
});
