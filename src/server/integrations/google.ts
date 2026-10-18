import "server-only";

/** Google OAuth 2.0 + Calendar REST adapter (I3). Tokens never leave the server. */
export const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
const clean = (v?: string) => (v ?? "").trim().replace(/^["']|["']$/g, "");

export function authUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: clean(process.env.GOOGLE_CLIENT_ID), redirect_uri: redirectUri, response_type: "code",
    scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface Tokens { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }

async function tokenCall(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clean(process.env.GOOGLE_CLIENT_ID), client_secret: clean(process.env.GOOGLE_CLIENT_SECRET), ...body }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json().catch(() => ({}))) as Tokens & { error?: string; error_description?: string };
  return { ok: res.ok, status: res.status, json };
}

export const exchangeCode = (code: string, redirectUri: string) => tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
export const refreshToken = (refresh: string) => tokenCall({ refresh_token: refresh, grant_type: "refresh_token" });

export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try { return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")).email ?? null; } catch { return null; }
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
}

export interface GResult<T> { ok: boolean; status: number; data?: T; error?: string; permanent?: boolean }

export async function gcal<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<GResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
        method, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
      });
      if (res.status === 204) return { ok: true, status: 204 };
      const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
      if (res.ok) return { ok: true, status: res.status, data: json };
      const temporary = res.status === 429 || res.status >= 500;
      if (temporary && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      return { ok: false, status: res.status, permanent: !temporary, error: `Google Calendar ${res.status}: ${json.error?.message ?? "request failed"}` };
    } catch (e) {
      if (attempt === 0) continue;
      return { ok: false, status: 0, error: `Google Calendar unreachable (${(e as Error).message}). Try again.` };
    }
  }
  return { ok: false, status: 0, error: "Google Calendar request failed." };
}

/** Converts a wall-clock time in an IANA zone to a UTC Date (I3.5), without external libraries. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const [d, t] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc);
}
