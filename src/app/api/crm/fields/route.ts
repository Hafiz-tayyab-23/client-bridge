import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createField, FieldInput, listFields } from "@/server/services/crm-config";

export const GET = route(async (req) => {
  const actor = await requireActor();
  return json({ fields: await listFields(actor, req.nextUrl.searchParams.get("entity") ?? undefined) });
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ field: await createField(actor, await readJson(req, FieldInput)) }, 201);
});
