import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { addNote, NoteInput } from "@/server/services/records";

export const POST = route(async (req, ctx: RouteContext<"/api/crm/contacts/[id]/notes">) => {
  const actor = await requireActor();
  return json(await addNote(actor, parseId((await ctx.params).id), await readJson(req, NoteInput)), 201);
});
