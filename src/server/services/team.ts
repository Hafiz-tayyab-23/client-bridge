import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { badRequest, forbidden, notFound } from "../http";
import { audit } from "../audit";
import { ALL_PERMISSIONS, PERMISSIONS, can, isPermission, requirePerm, type Actor } from "../permissions";

export const AVAILABILITY = ["available", "busy", "on_leave", "offline"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const UpdateUserInput = z.object({
  baseRole: z.enum(["admin", "user"]).optional(),
  roleId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  telegramChatId: z.string().trim().regex(/^-?\d{1,20}$/, "Telegram chat ID is numeric.").nullable().optional(),
});
export const RoleInput = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.string()).refine((ps) => ps.every(isPermission), "Unknown permission."),
});
export const AvailabilityInput = z.object({ availability: z.enum(AVAILABILITY) });

export async function listUsers(actor: Actor) {
  return sql`
    select u.id, u.name, u.email, u.base_role, u.role_id, r.name as role_name, u.availability, u.active,
           u.telegram_chat_id is not null as telegram_connected, u.created_at,
           (select count(*)::int from leads l where l.owner_id = u.id and l.status in ('assigned','acknowledged')) as open_leads
    from users u left join roles r on r.id = u.role_id
    where u.workspace_id = ${actor.workspaceId}
    order by (u.base_role = 'owner') desc, u.name`;
}

async function loadUser(actor: Actor, userId: string) {
  const [u] = await sql`select * from users where id = ${userId} and workspace_id = ${actor.workspaceId}`;
  if (!u) throw notFound("User not found.");
  return u;
}

/** Role / level changes (F1.2). An Admin can never modify the Owner. */
export async function updateUser(actor: Actor, userId: string, input: z.infer<typeof UpdateUserInput>) {
  const target = await loadUser(actor, userId);
  const self = target.id === actor.id;
  const onlyOwnTelegram = self && Object.keys(input).every((k) => k === "telegramChatId");
  if (!onlyOwnTelegram) requirePerm(actor, "users.manage");
  if (target.base_role === "owner" && actor.baseRole !== "owner") throw forbidden("Only the Owner can change the Owner.");
  if (target.base_role === "owner" && (input.baseRole || input.active === false)) throw forbidden("The Owner's level cannot be changed.");
  if (input.baseRole === "admin" && actor.baseRole !== "owner") throw forbidden("Only the Owner can grant Admin.");
  if (target.base_role === "admin" && actor.baseRole !== "owner" && !self && input.baseRole) throw forbidden("Only the Owner can change an Admin's level.");
  if (input.roleId) {
    const [r] = await sql`select id from roles where id = ${input.roleId} and workspace_id = ${actor.workspaceId}`;
    if (!r) throw badRequest("Unknown role.");
  }
  return sql.begin(async (tx) => {
    const [after] = await tx`
      update users set
        base_role = coalesce(${input.baseRole ?? null}, base_role),
        role_id = case when ${input.roleId !== undefined} then ${input.roleId ?? null}::uuid else role_id end,
        active = coalesce(${input.active ?? null}, active),
        telegram_chat_id = case when ${input.telegramChatId !== undefined} then ${input.telegramChatId ?? null} else telegram_chat_id end,
        updated_at = now()
      where id = ${userId} and workspace_id = ${actor.workspaceId}
      returning id, base_role, role_id, active, telegram_chat_id is not null as telegram_connected`;
    if (input.active === false) await tx`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    await audit(tx, actor.workspaceId, actor, {
      event: "user.role_changed",
      targetType: "user",
      targetId: userId,
      before: { base_role: target.base_role, role_id: target.role_id, active: target.active },
      after: { base_role: after.base_role, role_id: after.role_id, active: after.active },
    });
    return after;
  });
}

/** F3.2: an employee sets their own status; users with leads.assign may set anyone's. */
export async function setAvailability(actor: Actor, userId: string, availability: Availability) {
  const target = await loadUser(actor, userId);
  if (target.id !== actor.id && !can(actor, "leads.assign")) throw forbidden("You can only change your own availability.");
  await sql.begin(async (tx) => {
    await tx`update users set availability = ${availability}, updated_at = now() where id = ${userId} and workspace_id = ${actor.workspaceId}`;
    await audit(tx, actor.workspaceId, actor, {
      event: "user.availability_changed", targetType: "user", targetId: userId,
      before: { availability: target.availability }, after: { availability },
    });
  });
  return { id: userId, availability, previous: target.availability as Availability };
}

export async function listRoles(actor: Actor) {
  return sql`
    select r.id, r.name, r.permissions, r.is_system,
           (select count(*)::int from users u where u.role_id = r.id) as members
    from roles r where r.workspace_id = ${actor.workspaceId} order by r.name`;
}

function ownerOnly(actor: Actor) {
  if (actor.baseRole !== "owner") throw forbidden("Only the Owner can change role permissions.");
}

export async function createRole(actor: Actor, input: z.infer<typeof RoleInput>) {
  ownerOnly(actor);
  return sql.begin(async (tx) => {
    const [r] = await tx`insert into roles (workspace_id, name, permissions) values (${actor.workspaceId}, ${input.name}, ${input.permissions}) returning *`;
    await audit(tx, actor.workspaceId, actor, { event: "role.created", targetType: "role", targetId: r.id, after: { name: r.name, permissions: r.permissions } });
    return r;
  });
}

export async function updateRole(actor: Actor, roleId: string, input: z.infer<typeof RoleInput>) {
  ownerOnly(actor);
  return sql.begin(async (tx) => {
    const [before] = await tx`select * from roles where id = ${roleId} and workspace_id = ${actor.workspaceId} for update`;
    if (!before) throw notFound("Role not found.");
    const [r] = await tx`update roles set name = ${input.name}, permissions = ${input.permissions}, updated_at = now() where id = ${roleId} returning *`;
    await audit(tx, actor.workspaceId, actor, {
      event: "role.permissions_changed", targetType: "role", targetId: roleId,
      before: { name: before.name, permissions: before.permissions }, after: { name: r.name, permissions: r.permissions },
    });
    return r;
  });
}

export async function deleteRole(actor: Actor, roleId: string) {
  ownerOnly(actor);
  return sql.begin(async (tx) => {
    const [before] = await tx`select * from roles where id = ${roleId} and workspace_id = ${actor.workspaceId} for update`;
    if (!before) throw notFound("Role not found.");
    const [{ n }] = await tx`select count(*)::int as n from users where role_id = ${roleId}`;
    if (n > 0) throw badRequest(`${n} user(s) still have this role. Move them to another role first.`);
    await tx`delete from roles where id = ${roleId}`;
    await audit(tx, actor.workspaceId, actor, { event: "role.deleted", targetType: "role", targetId: roleId, before: { name: before.name, permissions: before.permissions } });
  });
}

export function permissionCatalog() {
  return ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSIONS[key] }));
}

export async function listInvitations(actor: Actor) {
  requirePerm(actor, "users.manage");
  return sql`
    select id, email, name, base_role, role_id, expires_at, accepted_at, revoked_at, created_at
    from invitations where workspace_id = ${actor.workspaceId} order by created_at desc limit 100`;
}
