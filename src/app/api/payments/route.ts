import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listPayments } from "@/server/services/payments";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return json(await listPayments(actor, {
    status: sp.get("status") ?? undefined,
    page: Math.max(1, Number(sp.get("page") ?? 1) || 1),
    pageSize: Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 25) || 25)),
  }));
});
