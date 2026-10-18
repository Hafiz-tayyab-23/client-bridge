import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createPipeline, listPipelines, PipelineInput } from "@/server/services/crm-config";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ pipelines: await listPipelines(actor) });
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ pipeline: await createPipeline(actor, await readJson(req, PipelineInput)) }, 201);
});
