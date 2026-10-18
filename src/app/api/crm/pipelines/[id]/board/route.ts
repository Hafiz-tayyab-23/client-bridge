import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { opportunityBoard } from "@/server/services/records";

export const GET = route(async (_req, ctx: RouteContext<"/api/crm/pipelines/[id]/board">) => {
  const actor = await requireActor();
  return json(await opportunityBoard(actor, parseId((await ctx.params).id)));
});
