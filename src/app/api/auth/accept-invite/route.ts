import { route, json, readJson, clientIp } from "@/server/http";
import { acceptInvite, AcceptInviteInput } from "@/server/services/accounts";
import { createSession } from "@/server/auth/session";

export const POST = route(async (req) => {
  const input = await readJson(req, AcceptInviteInput);
  const { userId } = await acceptInvite(input);
  await createSession(userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" });
  return json({ ok: true }, 201);
});
