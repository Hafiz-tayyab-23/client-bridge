import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { closeLead } from "@/server/services/leads";

export const POST = route(async (_req, ctx: RouteContext<"/api/leads/[id]/close">) => {
  const actor = await requireActor();
  return json(await closeLead(actor, parseId((await ctx.params).id)));
});
