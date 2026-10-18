import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { getThread } from "@/server/services/messaging";

export const GET = route(async (_req, ctx: RouteContext<"/api/conversations/[id]">) => {
  const actor = await requireActor();
  return json(await getThread(actor, parseId((await ctx.params).id)));
});
