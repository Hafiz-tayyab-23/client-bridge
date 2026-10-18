import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { PrefsInput, savePrefs } from "@/server/services/dashboard";

// Remembers which dashboard figures this user hides (F5.5), stored server-side per user.
export const PUT = route(async (req) => {
  const actor = await requireActor();
  return json(await savePrefs(actor, await readJson(req, PrefsInput)));
});
