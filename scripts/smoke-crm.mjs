// End-to-end API checks for the CRM (F2), field protection (F1.4) and audit (F4).
// Usage: BASE=http://localhost:3000 node scripts/smoke-crm.mjs
const BASE = process.env.BASE ?? "http://localhost:3000";
const run = Date.now().toString(36);
let pass = 0, fail = 0;

function client() {
  let cookie = "";
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { ...(body ? { "content-type": "application/json" } : {}), origin: BASE, ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const m = res.headers.get("set-cookie")?.match(/sid=([^;]*)/);
    if (m) cookie = m[1] ? `sid=${m[1]}` : "";
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, info !== undefined ? JSON.stringify(info).slice(0, 400) : ""); }
}

const owner = client(), sales = client(), other = client();
await owner("/api/auth/signup", { body: { workspaceName: `CRM ${run}`, name: "Olive Owner", email: `olive-${run}@demo.test`, password: "password123" } });
await other("/api/auth/signup", { body: { workspaceName: `Other ${run}`, name: "Otto", email: `otto-${run}@demo.test`, password: "password123" } });
const roles = (await owner("/api/team/roles")).data.roles;
const inv = await owner("/api/team/invitations", { body: { email: `sid-${run}@demo.test`, name: "Sid Sales", baseRole: "user", roleId: roles.find((r) => r.name === "Sales").id } });
await sales("/api/auth/accept-invite", { body: { token: new URL(inv.data.inviteUrl).searchParams.get("token"), password: "password123" } });
const sid = (await sales("/api/auth/me")).data.user.id;

console.log("F2.2/F2.3 custom fields per pipeline");
let r = await owner("/api/crm/pipelines");
const sales1 = r.data.pipelines[0];
r = await owner("/api/crm/pipelines", { body: { name: "Installations" } });
check("second pipeline created", r.status === 201, r);
const install = r.data.pipeline;
r = await owner("/api/crm/fields", { body: { entity: "contact", label: "Budget band", type: "dropdown", options: ["Low", "Mid", "High"] } });
check("contact dropdown field", r.status === 201 && r.data.field.key === "budget_band", r);
r = await owner("/api/crm/fields", { body: { entity: "opportunity", pipelineId: sales1.id, label: "Proposal sent", type: "date" } });
check("sales-pipeline date field", r.status === 201, r);
const proposalField = r.data.field;
r = await owner("/api/crm/fields", { body: { entity: "opportunity", pipelineId: install.id, label: "Roof area m2", type: "number" } });
check("install-pipeline number field", r.status === 201, r);
r = await sales("/api/crm/fields", { body: { entity: "contact", label: "Hack", type: "text" } });
check("User without crm.configure cannot add fields (403)", r.status === 403, r);

console.log("F2.1 records and relationships");
r = await owner("/api/crm/companies", { body: { name: "Sunrise Homes" } });
const company = r.data.company;
r = await owner("/api/crm/contacts", { body: { name: "Hina Khan", email: `hina-${run}@demo.test`, phone: `+92300${String(Date.now()).slice(-7)}`, companyId: company.id, tags: ["vip"], custom: { budget_band: "High" } } });
check("contact with company + custom value", r.status === 201 && r.data.contact.custom.budget_band === "High", r);
const contact = r.data.contact;
r = await owner("/api/crm/contacts", { body: { name: "Bad", email: "x@y.z", custom: { budget_band: "Huge" } } });
check("invalid dropdown value rejected (400)", r.status === 400, r);
r = await owner("/api/crm/opportunities", { body: { title: "Rooftop 10kW", pipelineId: sales1.id, contactId: contact.id, companyId: company.id, value: 12500, ownerId: sid } });
check("opportunity created for contact", r.status === 201, r);
let opp = r.data.opportunity;
r = await owner("/api/crm/opportunities", { body: { title: "Wrong field", pipelineId: sales1.id, custom: { roof_area_m2: 50 } } });
check("other pipeline's field rejected (F2.3)", r.status === 400, r);

console.log("F2.4/F2.5 stages");
const proposal = sales1.stages.find((s) => s.name === "Proposal");
r = await owner(`/api/crm/stages/${proposal.id}`, { method: "PUT", body: { name: "Proposal", kind: "open", requiredFieldIds: [proposalField.id] } });
check("stage requires Proposal sent", r.status === 200, r);
r = await owner(`/api/crm/opportunities/${opp.id}/move`, { body: { stageId: proposal.id, version: opp.version } });
check("move blocked with clear message (422)", r.status === 422 && /Proposal sent/.test(r.data.error.message), r);
r = await owner(`/api/crm/opportunities/${opp.id}`, { method: "PATCH", body: { title: opp.title, currency: "usd", custom: { proposal_sent: "2026-10-18" }, version: opp.version } });
check("fill required field", r.status === 200, r);
opp = r.data.opportunity;
r = await owner(`/api/crm/opportunities/${opp.id}`, { method: "PATCH", body: { title: "stale", currency: "usd", version: opp.version - 1 } });
check("stale version rejected (409, Q4)", r.status === 409, r);
r = await owner(`/api/crm/opportunities/${opp.id}/move`, { body: { stageId: proposal.id, version: opp.version } });
check("move now allowed", r.status === 200 && r.data.opportunity.stage_id === proposal.id, r);
opp = r.data.opportunity;
r = await owner(`/api/crm/pipelines/${sales1.id}/stages`, { body: { name: "Site visit", kind: "open" } });
check("add stage", r.status === 201, r);
const visit = r.data.stage;
r = await owner(`/api/crm/stages/${visit.id}`, { method: "PUT", body: { name: "Site survey", kind: "open", requiredFieldIds: [] } });
check("rename stage", r.status === 200 && r.data.stage.name === "Site survey", r);
r = await owner("/api/crm/pipelines");
const ids = r.data.pipelines.find((p) => p.id === sales1.id).stages.map((s) => s.id);
r = await owner(`/api/crm/pipelines/${sales1.id}/stages/order`, { method: "PUT", body: { stageIds: [ids.at(-1), ...ids.slice(0, -1)] } });
check("reorder stages", r.status === 200, r);
r = await owner(`/api/crm/stages/${proposal.id}`, { method: "DELETE" });
check("deleting non-empty stage requires target (409)", r.status === 409, r);
r = await owner(`/api/crm/stages/${proposal.id}?moveTo=${visit.id}`, { method: "DELETE" });
check("safe delete moves opportunities", r.status === 200 && r.data.moved === 1, r);

console.log("F1.4 value masking");
r = await sales(`/api/crm/opportunities/${opp.id}`);
check("Sales (owner of opp) sees it but value masked", r.status === 200 && r.data.opportunity.value_cents === null && r.data.opportunity.value_masked, r.data.opportunity);
r = await owner(`/api/crm/opportunities/${opp.id}`);
check("Owner sees value", r.data.opportunity.value_cents === 1250000, r.data.opportunity);
r = await sales("/api/crm/opportunities");
check("masked in list", r.data.opportunities.every((o) => o.value_cents === null), r.data);
r = await sales("/api/crm/export?entity=opportunity");
check("Sales cannot export without permission (403)", r.status === 403, r);
r = await owner("/api/crm/export?entity=opportunity");
check("Owner export has value", r.status === 200 && typeof r.data === "string" && r.data.includes("12500"), r.data);

console.log("F2.6 filters + saved list");
const custom = encodeURIComponent(JSON.stringify([{ key: "budget_band", op: "eq", value: "High" }]));
r = await owner(`/api/crm/contacts?tag=vip&custom=${custom}&createdFrom=2026-01-01`);
check("3-criteria filter finds contact", r.data.contacts?.length === 1, r.data);
r = await owner("/api/crm/lists", { body: { name: "VIP high budget", entity: "contact", filters: { tag: "vip", createdFrom: "2026-01-01", custom: [{ key: "budget_band", op: "eq", value: "High" }] } } });
const list = r.data.list;
r = await owner(`/api/crm/lists/${list.id}`);
check("saved list returns match", r.data.total === 1, r.data);
r = await owner(`/api/crm/contacts/${contact.id}`);
await owner(`/api/crm/contacts/${contact.id}`, { method: "PATCH", body: { name: contact.name, email: contact.email, phone: contact.phone, companyId: company.id, tags: ["vip"], custom: { budget_band: "Low" }, version: r.data.contact.version } });
r = await owner(`/api/crm/lists/${list.id}`);
check("list updates automatically when record stops matching", r.data.total === 0, r.data);

console.log("F2.7/F2.8 timeline + 360");
await owner(`/api/crm/contacts/${contact.id}/notes`, { body: { body: "Called, wants quote by Friday" } });
r = await owner(`/api/crm/contacts/${contact.id}`);
const types = r.data.timeline.map((t) => t.type);
check("timeline has note, edit, stage change", ["note", "contact.edited", "opportunity.stage_changed"].every((t) => types.includes(t)), types);
check("360 view has company, opportunities, payments, appointments, conversations", r.data.company && r.data.opportunities.length === 1 && Array.isArray(r.data.payments) && Array.isArray(r.data.appointments) && Array.isArray(r.data.conversations), Object.keys(r.data));

console.log("F1.6 isolation on CRM");
r = await other(`/api/crm/contacts/${contact.id}`);
check("other workspace cannot read contact (404)", r.status === 404, r);
r = await other(`/api/crm/opportunities/${opp.id}/move`, { body: { stageId: visit.id, version: 1 } });
check("other workspace cannot move opp (404)", r.status === 404, r);
r = await other("/api/crm/contacts", { body: { name: "X", email: "x@x.io", companyId: company.id } });
check("cannot link to other workspace's company (400)", r.status === 400, r);
r = await sales(`/api/crm/contacts/${contact.id}`);
check("Sales without view_all cannot see contact they don't own (404)", r.status === 404, r);

console.log("F4 audit");
r = await sales("/api/audit");
check("audit requires permission (403)", r.status === 403, r);
r = await owner("/api/audit?event=stage");
check("audit filter by event type", r.status === 200 && r.data.entries.length >= 3 && r.data.entries.every((e) => e.event.startsWith("stage")), r.data.entries?.map((e) => e.event));
const ownerId = (await owner("/api/auth/me")).data.user.id;
r = await owner(`/api/audit?actorId=${ownerId}&from=2026-01-01`);
check("audit filter by user + date", r.status === 200 && r.data.entries.every((e) => e.actor_id === ownerId), r.data.total);
r = await owner("/api/audit", { method: "DELETE" });
check("no delete endpoint (405)", r.status === 405, r.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
