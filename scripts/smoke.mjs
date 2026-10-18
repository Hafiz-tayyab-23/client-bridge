// End-to-end API checks for auth, permissions, isolation, leads and escalation.
// Usage: BASE=http://localhost:3000 WORKER_SECRET=... node scripts/smoke.mjs
const BASE = process.env.BASE ?? "http://localhost:3000";
const SECRET = process.env.WORKER_SECRET ?? "dev-worker-secret";
const run = Date.now().toString(36);
let pass = 0, fail = 0;

function client() {
  let cookie = "";
  return async (path, { method, body, origin = BASE, headers = {} } = {}) => {
    const res = await fetch(BASE + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { ...(body ? { "content-type": "application/json" } : {}), origin, ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/sid=([^;]*)/);
      if (m) cookie = m[1] ? `sid=${m[1]}` : "";
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, info !== undefined ? JSON.stringify(info).slice(0, 300) : ""); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => fetch(BASE + "/api/worker/tick", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }).then((r) => r.json());

console.log("F1 accounts");
const ownerA = client(), ownerB = client(), sales = client(), anon = client();
let r = await ownerA("/api/auth/signup", { body: { workspaceName: `Alpha ${run}`, name: "Alice Owner", email: `alice-${run}@demo.test`, password: "password123" } });
check("signup creates workspace (201)", r.status === 201, r);
const wsA = r.data.workspaceId;
r = await ownerA("/api/auth/me");
check("session persists; first user is owner", r.status === 200 && r.data.user.baseRole === "owner", r);
r = await ownerB("/api/auth/signup", { body: { workspaceName: `Beta ${run}`, name: "Bob Owner", email: `bob-${run}@demo.test`, password: "password123" } });
check("second workspace signup", r.status === 201, r);
r = await ownerA("/api/auth/signup", { body: { workspaceName: "X", name: "X", email: `alice-${run}@demo.test`, password: "password123" } });
check("duplicate email rejected (409)", r.status === 409, r);
r = await anon("/api/auth/signup", { body: { workspaceName: "", name: "X", email: "bad", password: "1" } });
check("invalid signup -> 400 with field details", r.status === 400 && Array.isArray(r.data.error?.details), r);

console.log("Q3 CSRF");
r = await ownerA("/api/team/invitations", { body: { email: `x-${run}@demo.test`, name: "X", baseRole: "user" }, origin: "https://evil.example" });
check("cross-origin mutation blocked (403)", r.status === 403, r);

console.log("F1.2 invite + roles");
const roles = (await ownerA("/api/team/roles")).data.roles;
const salesRole = roles.find((x) => x.name === "Sales");
r = await ownerA("/api/team/invitations", { body: { email: `sam-${run}@demo.test`, name: "Sam Sales", baseRole: "user", roleId: salesRole.id } });
check("owner invites user", r.status === 201 && r.data.inviteUrl, r);
const token = new URL(r.data.inviteUrl).searchParams.get("token");
r = await sales("/api/auth/accept-invite", { body: { token, password: "password123" } });
check("invitee accepts and is signed in", r.status === 201, r);
r = await sales("/api/auth/accept-invite", { body: { token, password: "password123" } });
check("invite token single-use", r.status === 404 || r.status === 409, r);
const samId = (await sales("/api/auth/me")).data.user.id;

console.log("F1.5 server-side enforcement");
r = await sales("/api/team/invitations", { body: { email: `z-${run}@demo.test`, name: "Z", baseRole: "user" } });
check("user without users.manage cannot invite (403)", r.status === 403, r);
r = await sales("/api/assignment-rules", { method: "PUT", body: { maxOpenLeads: 5, ackWindowSeconds: 10, levels: [{ type: "next_employee", window_seconds: 10 }], backupUserId: null, managerUserId: null, idleSeconds: 60, absencePolicy: "keep_acknowledged" } });
check("user cannot change assignment rules (403)", r.status === 403, r);
r = await sales(`/api/team/roles/${salesRole.id}`, { method: "PUT", body: { name: "Sales", permissions: ["crm.view", "users.manage"] } });
check("non-owner cannot edit role permissions (403)", r.status === 403, r);
const ownerAId = (await ownerA("/api/auth/me")).data.user.id;
r = await sales(`/api/team/users/${ownerAId}`, { method: "PATCH", body: { active: false } });
check("user cannot modify owner (403)", r.status === 403, r);
r = await anon("/api/team/users");
check("anonymous API call rejected (401)", r.status === 401, r);

console.log("F1.6 workspace isolation");
r = await ownerB("/api/team/users");
check("B sees only own users", r.status === 200 && r.data.users.every((u) => u.email.startsWith("bob-")), r.data.users?.map((u) => u.email));
r = await ownerB(`/api/team/users/${samId}`, { method: "PATCH", body: { baseRole: "admin" } });
check("B cannot change A's user by guessed id (404)", r.status === 404, r);
r = await ownerB(`/api/team/roles/${salesRole.id}`, { method: "PUT", body: { name: "pwn", permissions: [] } });
check("B cannot edit A's role by id (404)", r.status === 404, r);

console.log("F3 leads & escalation");
// Make the chain observable in seconds: 4s ack window, next employee then owner as manager.
r = await ownerA("/api/assignment-rules", { method: "PUT", body: { maxOpenLeads: 10, ackWindowSeconds: 5, levels: [{ type: "next_employee", window_seconds: 5 }, { type: "manager", window_seconds: 5 }], backupUserId: null, managerUserId: ownerAId, idleSeconds: 3600, absencePolicy: "keep_acknowledged" } });
check("owner configures rules", r.status === 200, r);
r = await anon(`/api/public/forms/${wsA}`, { body: { name: "Web Visitor", email: `visitor-${run}@demo.test`, message: "Need solar quote" } });
check("public web form creates lead", r.status === 201, r);
r = await ownerA("/api/leads?state=open");
const lead = r.data.leads?.[0];
check("lead has exactly one owner and a deadline", lead && lead.owner_id && lead.ack_deadline && lead.source === "web_form", lead);
r = await ownerB(`/api/leads/${lead.id}`);
check("B cannot read A's lead (404)", r.status === 404, r);
r = await sales(`/api/leads/${lead.id}`);
const salesCanSee = r.status === 200;
check("Sales sees lead only if owner", salesCanSee === (lead.owner_id === samId), { status: r.status, owner: lead.owner_id, samId });
await sleep(5600);
const [t1, t2] = await Promise.all([tick(), tick()]);
r = await ownerA(`/api/leads/${lead.id}`);
const d = r.data;
check("expired lead escalated exactly once despite concurrent ticks", d.lead.escalation_count === 1 && d.assignments.filter((a) => !a.ended_at).length === 1, { t1, t2, count: d.lead.escalation_count, a: d.assignments });
check("escalated to a different owner", d.lead.owner_id !== lead.owner_id, { before: lead.owner_id, after: d.lead.owner_id });
const owner2 = d.lead.owner_id;
const ack = owner2 === samId ? sales : ownerA;
r = await ack(`/api/leads/${lead.id}/acknowledge`, { method: "POST" });
check("new owner acknowledges", r.status === 200, r);
r = await ack(`/api/leads/${lead.id}/acknowledge`, { method: "POST" });
check("double acknowledge rejected (409)", r.status === 409, r);

console.log("F3.6 absence reassignment");
r = await ownerA("/api/leads", { body: { name: "Manual Lead", phone: "+923001112233" } });
check("manual lead created", r.status === 201, r);
const manual = r.data;
const holder = manual.ownerId === samId ? sales : ownerA;
const holderId = manual.ownerId;
r = await holder(`/api/team/users/${holderId}/availability`, { method: "PUT", body: { availability: "on_leave" } });
check("going on leave reassigns unacknowledged lead", r.status === 200 && r.data.reassigned >= 1, r);
r = await ownerA(`/api/leads/${manual.leadId}`);
check("lead now owned by someone else", r.data.lead.owner_id !== holderId, r.data.lead);
await holder(`/api/team/users/${holderId}/availability`, { method: "PUT", body: { availability: "available" } });

console.log("F4 audit append-only (db trigger) — checked separately");
console.log("Q1 login throttling");
const brute = client();
let last;
for (let i = 0; i < 6; i++) last = await brute("/api/auth/login", { body: { email: `alice-${run}@demo.test`, password: "wrong-pass" } });
check("6th failed login is throttled (429)", last.status === 429, last);
r = await ownerA("/api/auth/logout", { method: "POST" });
r = await ownerA("/api/auth/me");
check("logout ends session (401)", r.status === 401, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
