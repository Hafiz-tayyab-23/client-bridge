import { route, json, readJson, clientIp } from "@/server/http";
import { signup, SignupInput } from "@/server/services/accounts";
import { createSession } from "@/server/auth/session";

export const POST = route(async (req) => {
  const input = await readJson(req, SignupInput);
  const { userId, workspaceId } = await signup(input);
  await createSession(userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" });
  return json({ userId, workspaceId }, 201);
});
