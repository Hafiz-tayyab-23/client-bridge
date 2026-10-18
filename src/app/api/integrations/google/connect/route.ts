import { NextResponse, type NextRequest } from "next/server";
import { currentActor } from "@/server/auth/session";
import { randomToken } from "@/server/crypto";
import { authUrl, googleConfigured } from "@/server/integrations/google";
import { appOrigin } from "@/server/origin";

// Starts the per-employee OAuth consent flow (I3.1). State is a one-time httpOnly cookie bound to the user.
export async function GET(_req: NextRequest) {
  const actor = await currentActor();
  const origin = await appOrigin();
  if (!actor) return NextResponse.redirect(`${origin}/login?next=/calendar`);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/calendar?google_error=${encodeURIComponent("Google OAuth client is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")}`);
  const state = `${randomToken(18)}.${actor.id}`;
  const res = NextResponse.redirect(authUrl(`${origin}/api/integrations/google/callback`, state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
  return res;
}
