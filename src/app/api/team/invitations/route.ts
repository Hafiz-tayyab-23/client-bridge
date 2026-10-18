import { route, json, readJson } from "@/server/http";
import { requireActor } from "@/server/auth/session";
import { invite, InviteInput } from "@/server/services/accounts";
import { listInvitations } from "@/server/services/team";

export const GET = route(async () => {
  const actor = await requireActor();
  return json({ invitations: await listInvitations(actor) });
});

// Returns the one-time invite link; email delivery is out of scope, so the inviter shares it.
export const POST = route(async (req) => {
  const actor = await requireActor();
  const { invitation, token } = await invite(actor, await readJson(req, InviteInput));
  const base = req.nextUrl.origin; // the host the inviter is using (works for preview deployments too)
  return json({ invitation, inviteUrl: `${base}/invite?token=${encodeURIComponent(token)}` }, 201);
});
