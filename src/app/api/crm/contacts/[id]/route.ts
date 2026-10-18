import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { contact360, ContactInput, deleteContact, updateContact } from "@/server/services/records";

type Ctx = RouteContext<"/api/crm/contacts/[id]">;
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return json(await contact360(actor, parseId((await ctx.params).id)));
});
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return json({ contact: await updateContact(actor, parseId((await ctx.params).id), await readJson(req, ContactInput)) });
});
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  await deleteContact(actor, parseId((await ctx.params).id));
  return json({ ok: true });
});
