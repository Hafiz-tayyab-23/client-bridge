import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { cancel, reschedule, RescheduleInput } from "@/server/services/calendar";

type Ctx = RouteContext<"/api/appointments/[id]">;
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json({ appointment: await reschedule(actor, parseId((await ctx.params).id), await readJson(req, RescheduleInput)) });
});
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return json(await cancel(actor, parseId((await ctx.params).id)));
});
