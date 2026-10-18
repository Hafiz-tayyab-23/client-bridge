import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { MoveInput, moveOpportunity } from "@/server/services/records";

export const POST = route(async (req, ctx: RouteContext<"/api/crm/opportunities/[id]/move">) => {
  const actor = await requireActor();
  return json({ opportunity: await moveOpportunity(actor, parseId((await ctx.params).id), await readJson(req, MoveInput)) });
});
