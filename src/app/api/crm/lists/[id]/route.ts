import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { deleteSavedList, runSavedList } from "@/server/services/records";
import { parsePage } from "@/server/query";

type Ctx = RouteContext<"/api/crm/lists/[id]">;
// Runs the saved filters now, so membership updates as records start or stop matching.
export const GET = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json(await runSavedList(actor, parseId((await ctx.params).id), parsePage(req.nextUrl.searchParams)));
});
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  await deleteSavedList(actor, parseId((await ctx.params).id));
  return json({ ok: true });
});
