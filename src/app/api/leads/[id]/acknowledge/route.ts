import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { acknowledge } from "@/server/services/leads";

export const POST = route(async (_req, ctx: RouteContext<"/api/leads/[id]/acknowledge">) => {
  const actor = await requireActor();
  return json(await acknowledge(actor, parseId((await ctx.params).id)));
});
