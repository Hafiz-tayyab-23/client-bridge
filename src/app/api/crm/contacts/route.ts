import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { ContactInput, createContact, listContacts } from "@/server/services/records";
import { parseFilters, parsePage } from "@/server/query";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return json(await listContacts(actor, parseFilters(sp), parsePage(sp)));
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ contact: await createContact(actor, await readJson(req, ContactInput)) }, 201);
});
