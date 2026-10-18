import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createPaymentRequest, PaymentRequestInput } from "@/server/services/payments";

export const POST = route(async (req, ctx: RouteContext<"/api/crm/opportunities/[id]/payments">) => {
  const actor = await requireActor();
  return json({ payment: await createPaymentRequest(actor, parseId((await ctx.params).id), await readJson(req, PaymentRequestInput)) }, 201);
});
