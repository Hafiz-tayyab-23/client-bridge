import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { deleteField, FieldUpdateInput, updateField } from "@/server/services/crm-config";

type Ctx = RouteContext<"/api/crm/fields/[id]">;
export const PUT = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json({ field: await updateField(actor, parseId((await ctx.params).id), await readJson(req, FieldUpdateInput)) });
});
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  await deleteField(actor, parseId((await ctx.params).id));
  return json({ ok: true });
});
