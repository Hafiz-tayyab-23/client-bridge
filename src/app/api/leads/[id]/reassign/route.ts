import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { reassign, ReassignInput } from "@/server/services/leads";

export const POST = route(async (req, ctx: RouteContext<"/api/leads/[id]/reassign">) => {
  const actor = await requireActor();
  return json(await reassign(actor, parseId((await ctx.params).id), await readJson(req, ReassignInput)));
});
