import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createManualLead, LeadIntakeInput, LeadListQuery, listLeads } from "@/server/services/leads";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const q = LeadListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return json(await listLeads(actor, q));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return json(await createManualLead(actor, await readJson(req, LeadIntakeInput)), 201);
});
