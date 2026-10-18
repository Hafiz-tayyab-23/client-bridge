import "server-only";
import { forbidden } from "./http";

/** Permission keys (F1.3). Roles are named sets of these; nothing checks role names. */
export const PERMISSIONS = {
  "crm.view": "View CRM records",
  "crm.view_all": "View all records (not only own)",
  "crm.create": "Create CRM records",
  "crm.edit": "Edit CRM records",
  "crm.delete": "Delete CRM records",
  "crm.export": "Export CRM records",
  "crm.view_value": "See opportunity values",
  "crm.configure": "Configure fields and pipelines",
  "leads.assign": "Reassign leads and set others' availability",
  "assignment.manage": "Manage assignment rules",
  "integrations.manage": "Manage integrations",
  "audit.view": "View audit log",
  "users.manage": "Invite users and assign roles",
  "dashboard.company": "See company-wide dashboard",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}

/** Default roles seeded into every new workspace; the Owner can edit all of them. */
export const DEFAULT_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "Admin", permissions: ALL_PERMISSIONS },
  {
    name: "Manager",
    permissions: [
      "crm.view", "crm.view_all", "crm.create", "crm.edit", "crm.export", "crm.view_value",
      "leads.assign", "audit.view", "dashboard.company",
    ],
  },
  { name: "Sales", permissions: ["crm.view", "crm.create", "crm.edit"] },
];

export type BaseRole = "owner" | "admin" | "user";

export interface Actor {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  baseRole: BaseRole;
  roleId: string | null;
  permissions: Set<Permission>;
}

/** Owner always holds every permission; everyone else gets exactly their role's set. */
export function effectivePermissions(baseRole: BaseRole, rolePerms: string[] | null): Set<Permission> {
  if (baseRole === "owner") return new Set(ALL_PERMISSIONS);
  return new Set((rolePerms ?? []).filter(isPermission));
}

export function can(actor: Actor, p: Permission): boolean {
  return actor.permissions.has(p);
}

export function requirePerm(actor: Actor, ...perms: Permission[]): void {
  for (const p of perms) if (!actor.permissions.has(p)) throw forbidden(`Missing permission: ${PERMISSIONS[p]}.`);
}
