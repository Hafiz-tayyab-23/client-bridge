import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { z } from "zod";
import { listConversations, openConversation } from "@/server/services/messaging";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  const contactId = sp.get("contactId");
  return json({ conversations: await listConversations(actor, { filter: sp.get("filter") ?? undefined, q: sp.get("q") ?? undefined, contactId: contactId ? parseId(contactId) : undefined }) });
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  const { contactId } = await readJson(req, z.object({ contactId: z.string().uuid() }));
  return json(await openConversation(actor, contactId), 201);
});
