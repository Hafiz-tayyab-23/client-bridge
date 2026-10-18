import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { AuditQuery, listAudit } from "@/server/services/audit-log";

// GET only. There is intentionally no PUT/PATCH/DELETE for audit entries (F4.3).
export const GET = route(async (req) => {
  const actor = await requireActor();
  return json(await listAudit(actor, AuditQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
});
