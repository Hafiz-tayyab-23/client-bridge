import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { getCompany } from "@/server/services/records";

export const GET = route(async (_req, ctx: RouteContext<"/api/crm/companies/[id]">) => {
  const actor = await requireActor();
  return json(await getCompany(actor, parseId((await ctx.params).id)));
});
