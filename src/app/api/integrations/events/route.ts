import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { listEvents } from "@/server/services/integrations";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return json({ events: await listEvents(actor, { provider: sp.get("provider") ?? undefined, page: Math.max(1, Number(sp.get("page") ?? 1) || 1) }) });
});
