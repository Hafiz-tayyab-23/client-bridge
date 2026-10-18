import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { retryMessage } from "@/server/services/messaging";

export const POST = route(async (_req, ctx: RouteContext<"/api/messages/[id]/retry">) => {
  const actor = await requireActor();
  return json(await retryMessage(actor, parseId((await ctx.params).id)));
});
