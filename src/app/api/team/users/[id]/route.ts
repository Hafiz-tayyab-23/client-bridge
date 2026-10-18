import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { updateUser, UpdateUserInput } from "@/server/services/team";

export const PATCH = route(async (req, ctx: RouteContext<"/api/team/users/[id]">) => {
  const actor = await requireActor();
  const id = parseId((await ctx.params).id);
  return json({ user: await updateUser(actor, id, await readJson(req, UpdateUserInput)) });
});
