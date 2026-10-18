import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { getLead } from "@/server/services/leads";

export const GET = route(async (_req, ctx: RouteContext<"/api/leads/[id]">) => {
  const actor = await requireActor();
  return json(await getLead(actor, parseId((await ctx.params).id)));
});
