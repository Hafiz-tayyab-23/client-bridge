import { route, json, readJson, clientIp } from "@/server/http";
import { login, LoginInput } from "@/server/services/accounts";
import { createSession } from "@/server/auth/session";

export const POST = route(async (req) => {
  const input = await readJson(req, LoginInput);
  const ip = clientIp(req);
  const { userId } = await login(input, ip);
  await createSession(userId, { ip, userAgent: req.headers.get("user-agent") ?? "" });
  return json({ ok: true });
});
