import { route, json, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { syncSafepayPayment } from "@/server/services/safepay-events";

export const POST = route(async (_req, ctx: RouteContext<"/api/payments/[id]/sync">) => {
  const actor = await requireActor();
  return json(await syncSafepayPayment(actor, parseId((await ctx.params).id)));
});
