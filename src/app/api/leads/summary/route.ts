import { route, json } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { leadSummary } from "@/server/services/leads";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ counts: await leadSummary(actor) });
});
