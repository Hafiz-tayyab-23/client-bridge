import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { getRules, RulesInput, updateRules } from "@/server/services/leads";
import { sql } from "@/server/db";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ rules: await getRules(sql, actor.workspaceId) });
});

export const PUT = route(async (req) => {
  const actor = await requireActor();
  return json({ rules: await updateRules(actor, await readJson(req, RulesInput)) });
});
