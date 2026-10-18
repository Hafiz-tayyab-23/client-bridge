import { route, json } from "@/server/http";
import { destroySession } from "@/server/auth/session";

export const POST = route(async () => {
  await destroySession();
  return json({ ok: true });
});
