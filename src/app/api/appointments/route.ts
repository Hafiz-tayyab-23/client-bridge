import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { book, BookInput } from "@/server/services/calendar";

export const POST = route(async (req) => {
  const actor = await requireActor();
  return json(await book(actor, await readJson(req, BookInput)), 201);
});
