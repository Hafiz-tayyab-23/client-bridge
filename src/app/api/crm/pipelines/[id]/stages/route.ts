import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createStage, StageInput } from "@/server/services/crm-config";

export const POST = route(async (req, ctx: RouteContext<"/api/crm/pipelines/[id]/stages">) => {
  const actor = await requireActor();
  return json({ stage: await createStage(actor, parseId((await ctx.params).id), await readJson(req, StageInput)) }, 201);
});
