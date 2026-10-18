import "server-only";
import { cookies } from "next/headers";
import { sql } from "../db";
import { randomToken, sha256 } from "../crypto";
import { unauthorized } from "../http";
import { effectivePermissions, type Actor, type BaseRole } from "../permissions";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 7;
const IDLE_HOURS = 24;

/** Creates a server-side session (revocable, expiring) and sets an httpOnly cookie (Q1). */
export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`
    insert into sessions (user_id, token_hash, expires_at, ip, user_agent)
    values (${userId}, ${sha256(token)}, ${expires}, ${meta.ip ?? null}, ${(meta.userAgent ?? "").slice(0, 300)})`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql`update sessions set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
  jar.delete(SESSION_COOKIE);
}

/** Resolves the signed-in user from the session cookie, or null. */
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await sql<
    { session_id: string; last_seen_at: Date; id: string; workspace_id: string; name: string; email: string; base_role: BaseRole; role_id: string | null; permissions: string[] | null }[]
  >`
    select s.id as session_id, s.last_seen_at, u.id, u.workspace_id, u.name, u.email, u.base_role, u.role_id, r.permissions
    from sessions s
    join users u on u.id = s.user_id and u.active
    left join roles r on r.id = u.role_id and r.workspace_id = u.workspace_id
    where s.token_hash = ${sha256(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and s.last_seen_at > now() - make_interval(hours => ${IDLE_HOURS})`;
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 5 * 60_000) {
    await sql`update sessions set last_seen_at = now() where id = ${r.session_id}`;
  }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    email: r.email,
    baseRole: r.base_role,
    roleId: r.role_id,
    permissions: effectivePermissions(r.base_role, r.permissions),
  };
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) throw unauthorized();
  return a;
}
