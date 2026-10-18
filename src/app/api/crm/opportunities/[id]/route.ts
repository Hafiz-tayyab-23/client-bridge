import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { deleteOpportunity, getOpportunity, OpportunityInput, updateOpportunity } from "@/server/services/records";

type Ctx = RouteContext<"/api/crm/opportunities/[id]">;
const UpdateInput = OpportunityInput.omit({ pipelineId: true, stageId: true });
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return json(await getOpportunity(actor, parseId((await ctx.params).id)));
});
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json({ opportunity: await updateOpportunity(actor, parseId((await ctx.params).id), await readJson(req, UpdateInput)) });
});
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  await deleteOpportunity(actor, parseId((await ctx.params).id));
  return json({ ok: true });
});
