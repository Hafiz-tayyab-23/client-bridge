import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createSavedList, listSavedLists, SavedListInput } from "@/server/services/records";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ lists: await listSavedLists(actor) });
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ list: await createSavedList(actor, await readJson(req, SavedListInput)) }, 201);
});
