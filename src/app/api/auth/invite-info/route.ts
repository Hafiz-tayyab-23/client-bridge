import { route, json, badRequest } from "@/server/http";
import { inviteInfo } from "@/server/services/accounts";

export const GET = route(async (req) => {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) throw badRequest("Missing invitation token.");
  return json(await inviteInfo(token));
});
