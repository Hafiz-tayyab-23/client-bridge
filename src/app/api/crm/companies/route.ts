import { route, json, readJson, parseId } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { CompanyInput, createCompany, listCompanies } from "@/server/services/records";
import { parsePage } from "@/server/query";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return json(await listCompanies(actor, { q: sp.get("q") ?? undefined, ...parsePage(sp) }));
});
export const POST = route(async (req) => {
  const actor = await requireActor();
  return json({ company: await createCompany(actor, await readJson(req, CompanyInput)) }, 201);
});
