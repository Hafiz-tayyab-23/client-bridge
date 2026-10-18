import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { maskSecret } from "../crypto";
import { AppError, badRequest, conflict, forbidden, notFound } from "../http";
import { activity, audit } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { getConnection, markHealth, recordEvent, secretsOf, upsertConnection, type Connection } from "../integrations/store";
import { emailFromIdToken, exchangeCode, gcal, googleConfigured, refreshToken, revoke, zonedToUtc } from "../integrations/google";
import { recordLeadAction } from "./leads";

type GSecrets = { refresh_token: string; access_token: string; expires_at: number };

// ───────── Connection (I3.1, I3.2) ─────────
export async function completeOAuth(actor: Actor, code: string, redirectUri: string) {
  const r = await exchangeCode(code, redirectUri);
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "google", direction: "outbound", kind: "oauth.token", status: r.ok ? "ok" : "error", error: r.ok ? null : `${r.json.error}: ${r.json.error_description ?? ""}` });
  if (!r.ok || !r.json.refresh_token) throw badRequest(r.ok ? "Google did not return a refresh token. Disconnect the app in your Google account permissions and connect again." : `Google rejected the connection: ${r.json.error_description ?? r.json.error}`);
  const email = emailFromIdToken(r.json.id_token);
  const before = await getConnection(sql, actor.workspaceId, "google", actor.id);
  const conn = await upsertConnection(sql, actor.workspaceId, "google", actor.id, {
    status: "connected", config: { email, calendarId: "primary" },
    secrets: { refresh_token: r.json.refresh_token, access_token: r.json.access_token, expires_at: Date.now() + (r.json.expires_in - 60) * 1000 },
  });
  await audit(sql, actor.workspaceId, actor, { event: before ? "integration.changed" : "integration.connected", targetType: "integration", targetId: conn.id, after: { provider: "google", user: actor.id, email } });
  return { email };
}

export async function disconnectGoogle(actor: Actor, userId: string) {
  if (userId !== actor.id) requirePerm(actor, "integrations.manage");
  const c = await getConnection(sql, actor.workspaceId, "google", userId);
  if (!c) throw notFound("No Google Calendar connected.");
  const s = secretsOf<GSecrets>(c);
  if (s?.refresh_token) await revoke(s.refresh_token);
  await upsertConnection(sql, actor.workspaceId, "google", userId, { status: "not_connected", config: {}, secrets: null });
  await audit(sql, actor.workspaceId, actor, { event: "integration.disconnected", targetType: "integration", targetId: c.id, before: { provider: "google", user: userId, email: c.config.email } });
}

/** Returns a fresh access token; marks the connection as needing reconnection when revoked/expired (I3.2). */
async function accessToken(conn: Connection): Promise<string> {
  const s = secretsOf<GSecrets>(conn);
  if (!s) throw new AppError(409, "calendar_not_connected", "This employee has not connected Google Calendar.");
  if (s.access_token && s.expires_at > Date.now() + 30_000) return s.access_token;
  const r = await refreshToken(s.refresh_token);
  if (!r.ok) {
    const msg = r.json.error === "invalid_grant" ? "Google access was revoked or expired. Reconnect Google Calendar." : `Token refresh failed: ${r.json.error_description ?? r.json.error}`;
    await markHealth(sql, conn.id, false, msg, r.json.error === "invalid_grant" ? "needs_reconnect" : "error");
    await recordEvent(sql, { workspaceId: conn.workspace_id, provider: "google", direction: "outbound", kind: "oauth.refresh", status: "error", error: msg });
    throw new AppError(409, "calendar_reconnect", msg);
  }
  await upsertConnection(sql, conn.workspace_id, "google", conn.user_id, {
    status: "connected", config: conn.config,
    secrets: { ...s, access_token: r.json.access_token, expires_at: Date.now() + (r.json.expires_in - 60) * 1000, ...(r.json.refresh_token ? { refresh_token: r.json.refresh_token } : {}) },
  });
  return r.json.access_token;
}

async function employeeConn(actor: Actor, userId: string) {
  const [u] = await sql`select id, name, active from users where id = ${userId} and workspace_id = ${actor.workspaceId}`;
  if (!u) throw notFound("Employee not found.");
  const conn = await getConnection(sql, actor.workspaceId, "google", userId);
  if (!conn || conn.status === "not_connected") throw new AppError(409, "calendar_not_connected", `${u.name} has not connected Google Calendar, so they cannot be booked. They can connect it on the Calendar page.`);
  if (conn.status === "needs_reconnect") throw new AppError(409, "calendar_reconnect", `${u.name}'s Google Calendar connection expired. They need to reconnect it on the Calendar page.`);
  return { user: u, conn };
}

export async function calendarStatus(actor: Actor) {
  const rows = await sql`
    select u.id, u.name, u.availability, ic.status, ic.config->>'email' as email, ic.last_error, ic.last_success_at
    from users u left join integration_connections ic on ic.user_id = u.id and ic.provider = 'google'
    where u.workspace_id = ${actor.workspaceId} and u.active order by u.name`;
  return {
    configured: googleConfigured(),
    employees: rows.map((r) => ({ ...r, status: r.status ?? "not_connected", email: can(actor, "integrations.manage") || r.id === actor.id ? r.email : r.email ? maskSecret(r.email) : null })),
  };
}

// ───────── Availability (I3.4) ─────────
async function conflicts(actor: Actor, userId: string, token: string, start: Date, end: Date, excludeId?: string) {
  const fb = await gcal<{ calendars: Record<string, { busy: { start: string; end: string }[]; errors?: unknown[] }> }>(token, "POST", "/freeBusy", {
    timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: "primary" }],
  });
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "google", direction: "outbound", kind: "freeBusy", status: fb.ok ? "ok" : "error", error: fb.error });
  if (!fb.ok) throw new AppError(fb.permanent ? 400 : 503, "provider_error", fb.error ?? "Could not read busy times.");
  const ownIds = excludeId ? (await sql`select provider_event from appointments where id = ${excludeId}`)[0]?.provider_event : null;
  const busy = (fb.data?.calendars?.primary?.busy ?? []).map((b) => ({ start: b.start, end: b.end, source: "Google Calendar" }));
  const local = await sql`select id, title, starts_at, ends_at from appointments where workspace_id = ${actor.workspaceId} and user_id = ${userId}
    and status = 'scheduled' and starts_at < ${end} and ends_at > ${start} ${excludeId ? sql`and id <> ${excludeId}` : sql``}`;
  // When rescheduling, the employee's own event for this appointment shows as busy; ignore that window.
  const own = excludeId ? (await sql`select starts_at, ends_at from appointments where id = ${excludeId}`)[0] : null;
  const filtered = busy.filter((b) => !(ownIds && own && Date.parse(b.start) === new Date(own.starts_at).getTime() && Date.parse(b.end) === new Date(own.ends_at).getTime()));
  return [...filtered, ...local.map((a) => ({ start: new Date(a.starts_at).toISOString(), end: new Date(a.ends_at).toISOString(), source: `Appointment: ${a.title}` }))];
}

export const BookInput = z.object({
  contactId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time."),
  durationMinutes: z.number().int().min(5).max(480),
  timezone: z.string().min(1).max(64),
  allowConflict: z.boolean().optional(),
});
export const RescheduleInput = BookInput.pick({ startLocal: true, durationMinutes: true, timezone: true, allowConflict: true });

function window(input: { startLocal: string; durationMinutes: number; timezone: string }) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }); } catch { throw badRequest("Unknown time zone."); }
  const start = zonedToUtc(input.startLocal, input.timezone);
  if (start.getTime() < Date.now() - 60_000) throw badRequest("Choose a time in the future.");
  return { start, end: new Date(start.getTime() + input.durationMinutes * 60_000) };
}

/** I3.3: books on the employee's real Google Calendar and on the customer record. */
export async function book(actor: Actor, input: z.infer<typeof BookInput>) {
  requirePerm(actor, "crm.edit");
  const [contact] = await sql`select id, name, email from contacts where id = ${input.contactId} and workspace_id = ${actor.workspaceId}`;
  if (!contact) throw notFound("Contact not found.");
  if (input.opportunityId) {
    const [o] = await sql`select 1 from opportunities where id = ${input.opportunityId} and workspace_id = ${actor.workspaceId}`;
    if (!o) throw badRequest("Unknown opportunity.");
  }
  const { user, conn } = await employeeConn(actor, input.userId);
  const { start, end } = window(input);
  const token = await accessToken(conn);
  const clash = await conflicts(actor, input.userId, token, start, end);
  if (clash.length && !input.allowConflict) throw new AppError(409, "conflict", `${user.name} is busy at that time.`, { conflicts: clash });
  const ev = await gcal<{ id: string; htmlLink: string }>(token, "POST", "/calendars/primary/events", {
    summary: `${input.title} — ${contact.name}`, description: `Booked from LeadGuard by ${actor.name}.`,
    start: { dateTime: start.toISOString(), timeZone: input.timezone }, end: { dateTime: end.toISOString(), timeZone: input.timezone },
  });
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "google", direction: "outbound", kind: "event.create", status: ev.ok ? "ok" : "error", reference: ev.data?.id, error: ev.error });
  if (!ev.ok || !ev.data) { await markHealth(sql, conn.id, false, ev.error); throw new AppError(ev.permanent ? 400 : 503, "provider_error", ev.error ?? "Google Calendar rejected the event."); }
  await markHealth(sql, conn.id, true);
  return sql.begin(async (tx) => {
    const [a] = await tx`
      insert into appointments (workspace_id, contact_id, opportunity_id, user_id, title, starts_at, ends_at, timezone, provider_event, created_by)
      values (${actor.workspaceId}, ${contact.id}, ${input.opportunityId ?? null}, ${input.userId}, ${input.title}, ${start}, ${end}, ${input.timezone}, ${ev.data!.id}, ${actor.id})
      returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: contact.id, opportunityId: input.opportunityId ?? null, type: "appointment.booked", summary: `Appointment “${input.title}” with ${user.name}, ${input.startLocal.replace("T", " ")} (${input.timezone})${clash.length ? " — booked despite a conflict" : ""}` });
    await audit(tx, actor.workspaceId, actor, { event: "appointment.created", targetType: "appointment", targetId: a.id, after: { user_id: input.userId, starts_at: start, timezone: input.timezone, google_event: ev.data!.id } });
    await recordLeadAction(tx, actor, contact.id, "appointment");
    return { appointment: a, link: ev.data!.htmlLink };
  });
}

async function loadAppt(actor: Actor, id: string) {
  const [a] = await sql`select * from appointments where id = ${id} and workspace_id = ${actor.workspaceId}`;
  if (!a) throw notFound("Appointment not found.");
  if (a.user_id !== actor.id && a.created_by !== actor.id && !can(actor, "crm.edit")) throw forbidden();
  if (a.status === "cancelled") throw conflict("This appointment is already cancelled.");
  return a;
}

/** I3.6: reschedule updates the Google event and the activity history. */
export async function reschedule(actor: Actor, id: string, input: z.infer<typeof RescheduleInput>) {
  const a = await loadAppt(actor, id);
  const { conn } = await employeeConn(actor, a.user_id);
  const { start, end } = window(input);
  const token = await accessToken(conn);
  const clash = await conflicts(actor, a.user_id, token, start, end, id);
  if (clash.length && !input.allowConflict) throw new AppError(409, "conflict", "The employee is busy at the new time.", { conflicts: clash });
  const ev = await gcal(token, "PATCH", `/calendars/primary/events/${encodeURIComponent(a.provider_event)}`, {
    start: { dateTime: start.toISOString(), timeZone: input.timezone }, end: { dateTime: end.toISOString(), timeZone: input.timezone },
  });
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "google", direction: "outbound", kind: "event.update", status: ev.ok ? "ok" : "error", reference: a.provider_event, error: ev.error });
  if (!ev.ok) throw new AppError(ev.permanent ? 400 : 503, "provider_error", ev.error ?? "Google Calendar update failed.");
  return sql.begin(async (tx) => {
    const [after] = await tx`update appointments set starts_at = ${start}, ends_at = ${end}, timezone = ${input.timezone}, updated_at = now() where id = ${id} returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: a.contact_id, opportunityId: a.opportunity_id, type: "appointment.rescheduled", summary: `Appointment “${a.title}” moved to ${input.startLocal.replace("T", " ")} (${input.timezone})` });
    await audit(tx, actor.workspaceId, actor, { event: "appointment.rescheduled", targetType: "appointment", targetId: id, before: { starts_at: a.starts_at, timezone: a.timezone }, after: { starts_at: start, timezone: input.timezone } });
    return after;
  });
}

export async function cancel(actor: Actor, id: string) {
  const a = await loadAppt(actor, id);
  const { conn } = await employeeConn(actor, a.user_id);
  const token = await accessToken(conn);
  const ev = await gcal(token, "DELETE", `/calendars/primary/events/${encodeURIComponent(a.provider_event)}`);
  const gone = ev.status === 404 || ev.status === 410;
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "google", direction: "outbound", kind: "event.delete", status: ev.ok || gone ? "ok" : "error", reference: a.provider_event, error: ev.ok || gone ? null : ev.error });
  if (!ev.ok && !gone) throw new AppError(ev.permanent ? 400 : 503, "provider_error", ev.error ?? "Google Calendar cancellation failed.");
  return sql.begin(async (tx) => {
    await tx`update appointments set status = 'cancelled', updated_at = now() where id = ${id}`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: a.contact_id, opportunityId: a.opportunity_id, type: "appointment.cancelled", summary: `Appointment “${a.title}” cancelled${gone ? " (event was already removed in Google)" : ""}` });
    await audit(tx, actor.workspaceId, actor, { event: "appointment.cancelled", targetType: "appointment", targetId: id, before: { status: "scheduled" }, after: { status: "cancelled" } });
    return { ok: true };
  });
}

export async function listAppointments(actor: Actor, q: { from?: string; to?: string }) {
  const mine = can(actor, "crm.view_all") ? null : actor.id;
  return sql`
    select a.id, a.title, a.starts_at, a.ends_at, a.timezone, a.status, a.provider_event, a.user_id, u.name as user_name, a.contact_id, c.name as contact_name
    from appointments a left join users u on u.id = a.user_id left join contacts c on c.id = a.contact_id
    where a.workspace_id = ${actor.workspaceId} ${mine ? sql`and a.user_id = ${mine}` : sql``}
      and a.starts_at >= ${q.from ?? new Date(Date.now() - 7 * 86400_000).toISOString()} and a.starts_at < ${q.to ?? new Date(Date.now() + 60 * 86400_000).toISOString()}
    order by a.starts_at limit 300`;
}
