import { route, badRequest } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { exportCsv } from "@/server/services/records";
import { parseFilters } from "@/server/query";

// GET /api/crm/export?entity=contact|opportunity&<filters>
export const GET = route(async (req) => {
  const actor = await requireActor();
  const entity = req.nextUrl.searchParams.get("entity");
  if (entity !== "contact" && entity !== "opportunity") throw badRequest("entity must be contact or opportunity.");
  const csv = await exportCsv(actor, entity, parseFilters(req.nextUrl.searchParams));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity}s-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
