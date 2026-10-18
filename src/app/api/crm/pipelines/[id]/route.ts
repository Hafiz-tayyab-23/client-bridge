import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { PipelineInput, renamePipeline } from "@/server/services/crm-config";

export const PUT = route(async (req, ctx: RouteContext<"/api/crm/pipelines/[id]">) => {
  const actor = await requireActor();
  return json({ pipeline: await renamePipeline(actor, parseId((await ctx.params).id), await readJson(req, PipelineInput)) });
});
