import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { createRole, listRoles, permissionCatalog, RoleInput } from "@/server/services/team";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ roles: await listRoles(actor), permissions: permissionCatalog() });
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ role: await createRole(actor, await readJson(req, RoleInput)) }, 201);
});
