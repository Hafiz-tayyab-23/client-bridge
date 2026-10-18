import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { sendMessage, SendInput } from "@/server/services/messaging";

export const POST = route(async (req, ctx: RouteContext<"/api/conversations/[id]/messages">) => {
  const actor = await requireActor();
  return json(await sendMessage(actor, parseId((await ctx.params).id), await readJson(req, SendInput)), 201);
});
