import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { deleteStage, StageInput, updateStage } from "@/server/services/crm-config";

type Ctx = RouteContext<"/api/crm/stages/[id]">;
export const PUT = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json({ stage: await updateStage(actor, parseId((await ctx.params).id), await readJson(req, StageInput)) });
});
// DELETE /api/crm/stages/:id?moveTo=<stageId>
export const DELETE = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const moveTo = req.nextUrl.searchParams.get("moveTo");
  return json(await deleteStage(actor, parseId((await ctx.params).id), { moveToStageId: moveTo ? parseId(moveTo) : null }));
});
