import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { deleteRole, updateRole, RoleInput } from "@/server/services/team";

export const PUT = route(async (req, ctx: RouteContext<"/api/team/roles/[id]">) => {
  const actor = await requireActor();
  const id = parseId((await ctx.params).id);
  return json({ role: await updateRole(actor, id, await readJson(req, RoleInput)) });
});

export const DELETE = route(async (_req, ctx: RouteContext<"/api/team/roles/[id]">) => {
  const actor = await requireActor();
  await deleteRole(actor, parseId((await ctx.params).id));
  return json({ ok: true });
});
