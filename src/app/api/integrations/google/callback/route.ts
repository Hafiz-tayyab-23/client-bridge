import { NextResponse, type NextRequest } from "next/server";
import { currentActor } from "@/server/auth/session";
import { safeEqual } from "@/server/crypto";
import { appOrigin } from "@/server/origin";
import { completeOAuth } from "@/server/services/calendar";

export async function GET(req: NextRequest) {
  const origin = await appOrigin();
  const fail = (m: string) => {
    const r = NextResponse.redirect(`${origin}/calendar?google_error=${encodeURIComponent(m)}`);
    r.cookies.delete({ name: "g_oauth_state", path: "/api/integrations/google" });
    return r;
  };
  const actor = await currentActor();
  if (!actor) return NextResponse.redirect(`${origin}/login?next=/calendar`);
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail(`Google consent was not granted (${sp.get("error")}).`);
  const state = sp.get("state") ?? "";
  const cookie = req.cookies.get("g_oauth_state")?.value ?? "";
  if (!state || !cookie || !safeEqual(state, cookie) || !state.endsWith(`.${actor.id}`)) return fail("The sign-in link expired or did not match. Please try connecting again.");
  try {
    const { email } = await completeOAuth(actor, sp.get("code") ?? "", `${origin}/api/integrations/google/callback`);
    const r = NextResponse.redirect(`${origin}/calendar?google=connected${email ? `&email=${encodeURIComponent(email)}` : ""}`);
    r.cookies.delete({ name: "g_oauth_state", path: "/api/integrations/google" });
    return r;
  } catch (e) {
    return fail((e as Error).message);
  }
}
