export interface Me {
  user: { id: string; name: string; email: string; workspaceId: string; baseRole: "owner" | "admin" | "user"; roleId: string | null; permissions: string[] };
  workspace: { id: string; name: string; timezone: string };
}
