import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { reorderStages, StageOrderInput } from "@/server/services/crm-config";

export const PUT = route(async (req, ctx: RouteContext<"/api/crm/pipelines/[id]/stages/order">) => {
  const actor = await requireActor();
  await reorderStages(actor, parseId((await ctx.params).id), await readJson(req, StageOrderInput));
  return json({ ok: true });
});
