import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { AvailabilityInput } from "@/server/services/team";
import { changeAvailability } from "@/server/services/leads";

export const PUT = route(async (req, ctx: RouteContext<"/api/team/users/[id]/availability">) => {
  const actor = await requireActor();
  const id = parseId((await ctx.params).id);
  const { availability } = await readJson(req, AvailabilityInput);
  return json(await changeAvailability(actor, id, availability));
});
