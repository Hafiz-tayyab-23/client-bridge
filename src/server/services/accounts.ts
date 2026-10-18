import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql, type Tx } from "../db";
import { randomToken, sha256 } from "../crypto";
import { AppError, badRequest, conflict, forbidden, notFound } from "../http";
import { audit } from "../audit";
import { DEFAULT_ROLES, ALL_PERMISSIONS, requirePerm, type Actor, type BaseRole } from "../permissions";

const BCRYPT_ROUNDS = 11;
const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, "Use at least 8 characters.").max(200);

export const SignupInput = z.object({
  workspaceName: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  email,
  password,
});
export const LoginInput = z.object({ email, password: z.string().min(1).max(200) });
export const InviteInput = z.object({
  email,
  name: z.string().trim().min(1).max(120),
  baseRole: z.enum(["admin", "user"]),
  roleId: z.string().uuid().nullable().optional(),
});
export const AcceptInviteInput = z.object({ token: z.string().min(10).max(200), password });

/** Seeds roles, a default pipeline and assignment rules for a new workspace. */
async function bootstrapWorkspace(tx: Tx, workspaceId: string) {
  const roleIds: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const [row] = await tx`insert into roles (workspace_id, name, permissions, is_system)
      values (${workspaceId}, ${r.name}, ${r.permissions}, false) returning id`;
    roleIds[r.name] = row.id;
  }
  const [p] = await tx`insert into pipelines (workspace_id, name, position) values (${workspaceId}, 'Sales', 0) returning id`;
  const stages: [string, string][] = [
    ["New", "open"], ["Qualified", "open"], ["Proposal", "open"], ["Won", "won"], ["Lost", "lost"],
  ];
  for (const [i, [name, kind]] of stages.entries()) {
    await tx`insert into stages (workspace_id, pipeline_id, name, position, kind) values (${workspaceId}, ${p.id}, ${name}, ${i}, ${kind})`;
  }
  await tx`insert into assignment_rules (workspace_id) values (${workspaceId})`;
  return roleIds;
}

export async function signup(input: z.infer<typeof SignupInput>) {
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return sql.begin(async (tx) => {
    const [exists] = await tx`select 1 from users where lower(email) = ${input.email}`;
    if (exists) throw conflict("An account with this email already exists. Sign in instead.");
    const [ws] = await tx`insert into workspaces (name) values (${input.workspaceName}) returning id, name`;
    const roleIds = await bootstrapWorkspace(tx, ws.id);
    const [user] = await tx`
      insert into users (workspace_id, email, name, password_hash, base_role, role_id)
      values (${ws.id}, ${input.email}, ${input.name}, ${hash}, 'owner', ${roleIds.Admin}) returning id, name, email`;
    await audit(tx, ws.id, user as never, { event: "workspace.created", targetType: "workspace", targetId: ws.id, after: { name: ws.name } });
    return { userId: user.id as string, workspaceId: ws.id as string };
  });
}

const FAIL_WINDOW_MIN = 15;
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 30;
let dummyHash: string | undefined;

/** Verifies credentials with per-email and per-IP throttling (Q1). */
export async function login(input: z.infer<typeof LoginInput>, ip: string) {
  const [{ by_email, by_ip }] = await sql`
    select
      count(*) filter (where lower(email) = ${input.email} and not success) as by_email,
      count(*) filter (where ip = ${ip} and not success) as by_ip
    from login_attempts where created_at > now() - make_interval(mins => ${FAIL_WINDOW_MIN})`;
  if (Number(by_email) >= MAX_FAILS_PER_EMAIL || Number(by_ip) >= MAX_FAILS_PER_IP) {
    throw new AppError(429, "too_many_attempts", `Too many failed sign-in attempts. Try again in ${FAIL_WINDOW_MIN} minutes.`);
  }
  const [user] = await sql`select id, password_hash, active from users where lower(email) = ${input.email}`;
  // Compare against a dummy hash when the user is unknown to keep timing similar.
  dummyHash ??= await bcrypt.hash("timing-equaliser", BCRYPT_ROUNDS);
  const ok = await bcrypt.compare(input.password, user?.password_hash ?? dummyHash);
  const success = Boolean(user && user.active && ok);
  await sql`insert into login_attempts (email, ip, success) values (${input.email}, ${ip}, ${success})`;
  if (!success) throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  return { userId: user.id as string };
}

export async function invite(actor: Actor, input: z.infer<typeof InviteInput>) {
  requirePerm(actor, "users.manage");
  if (input.baseRole === "admin" && actor.baseRole !== "owner") throw forbidden("Only the Owner can invite Admins.");
  return sql.begin(async (tx) => {
    if (input.roleId) {
      const [r] = await tx`select id from roles where id = ${input.roleId} and workspace_id = ${actor.workspaceId}`;
      if (!r) throw badRequest("Unknown role.");
    }
    const [exists] = await tx`select 1 from users where lower(email) = ${input.email}`;
    if (exists) throw conflict("A user with this email already exists.");
    const token = randomToken(24);
    const [inv] = await tx`
      insert into invitations (workspace_id, email, name, base_role, role_id, token_hash, invited_by, expires_at)
      values (${actor.workspaceId}, ${input.email}, ${input.name}, ${input.baseRole}, ${input.roleId ?? null},
              ${sha256(token)}, ${actor.id}, now() + interval '7 days')
      returning id, email, name, base_role, role_id, expires_at`;
    await audit(tx, actor.workspaceId, actor, { event: "user.invited", targetType: "invitation", targetId: inv.id, after: inv });
    return { invitation: inv, token };
  });
}

export async function acceptInvite(input: z.infer<typeof AcceptInviteInput>) {
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return sql.begin(async (tx) => {
    const [inv] = await tx`
      select * from invitations where token_hash = ${sha256(input.token)}
        and accepted_at is null and revoked_at is null and expires_at > now() for update`;
    if (!inv) throw notFound("This invitation is invalid or has expired. Ask your admin for a new one.");
    const [exists] = await tx`select 1 from users where lower(email) = ${inv.email}`;
    if (exists) throw conflict("An account with this email already exists.");
    const [user] = await tx`
      insert into users (workspace_id, email, name, password_hash, base_role, role_id)
      values (${inv.workspace_id}, ${inv.email}, ${inv.name}, ${hash}, ${inv.base_role}, ${inv.role_id}) returning id, name, email`;
    await tx`update invitations set accepted_at = now() where id = ${inv.id}`;
    await audit(tx, inv.workspace_id, user as never, {
      event: "user.joined", targetType: "user", targetId: user.id, after: { email: inv.email, base_role: inv.base_role, role_id: inv.role_id },
    });
    return { userId: user.id as string };
  });
}

export async function inviteInfo(token: string) {
  const [inv] = await sql`
    select i.email, i.name, w.name as workspace from invitations i join workspaces w on w.id = i.workspace_id
    where i.token_hash = ${sha256(token)} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`;
  if (!inv) throw notFound("This invitation is invalid or has expired.");
  return inv;
}

export function me(actor: Actor) {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    workspaceId: actor.workspaceId,
    baseRole: actor.baseRole as BaseRole,
    roleId: actor.roleId,
    permissions: ALL_PERMISSIONS.filter((p) => actor.permissions.has(p)),
  };
}
