"use client";
import { useState } from "react";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Modal, Note, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface Emp { id: string; name: string; status: string; availability: string }
interface Conflict { start: string; end: string; source: string }
const ZONES = ["Asia/Karachi", "Asia/Dubai", "Europe/London", "America/New_York", "America/Chicago", "Asia/Seoul", "UTC"];

/** Books on the employee's real Google Calendar; the server checks busy times (I3.3, I3.4, I3.5). */
export function BookModal({ contactId, appointment, onClose }: {
  contactId?: string; onClose: () => void;
  appointment?: { id: string; title: string; starts_at: string; ends_at: string; timezone: string; user_name: string | null };
}) {
  const me = useMe();
  const toast = useToast();
  const cal = useApi<{ employees: Emp[] }>("/api/calendar");
  const contacts = useApi<{ contacts: { id: string; name: string }[] }>(contactId || appointment ? null : "/api/crm/contacts?pageSize=100");
  const [tz, setTz] = useState(appointment?.timezone ?? me.workspace.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [clash, setClash] = useState<Conflict[] | null>(null);
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];
  const local = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
  const initStart = appointment ? local(appointment.starts_at) : "";
  const initDur = appointment ? Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000) : 30;

  async function submit(form: HTMLFormElement, allowConflict = false) {
    const f = new FormData(form);
    const startLocal = `${f.get("date")}T${f.get("time")}`;
    setBusy(true); setError(null); setErrs({});
    try {
      if (appointment) {
        await api(`/api/appointments/${appointment.id}`, { method: "PATCH", body: { startLocal, durationMinutes: Number(f.get("duration")), timezone: tz, allowConflict } });
        toast("Rescheduled — the Google Calendar event was updated");
      } else {
        await api("/api/appointments", { body: { contactId: contactId ?? f.get("contactId"), userId: f.get("userId"), title: f.get("title"), startLocal, durationMinutes: Number(f.get("duration")), timezone: tz, allowConflict } });
        toast("Booked on the employee’s Google Calendar");
      }
      refreshAll(); onClose();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 409 && ae.body.code === "conflict") setClash((ae.body.details as { conflicts: Conflict[] }).conflicts);
      setError(ae.message); setErrs(fieldErrors(err)); setBusy(false);
    }
  }
  const emps = cal.data?.employees ?? [];
  return (
    <Modal title={appointment ? `Reschedule “${appointment.title}”` : "Book appointment"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn>
        {clash && <Btn variant="dng" busy={busy} onClick={() => submit(document.getElementById("bk") as HTMLFormElement, true)}>Book anyway</Btn>}
        <Btn variant="pri" busy={busy} type="submit" form="bk"><CalendarCheck size={16} />{appointment ? "Check & reschedule" : "Check & book"}</Btn></>}>
      <form id="bk" onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        {clash && <div className="err" style={{ marginBottom: 12 }}><TriangleAlert size={16} /><div><b>Busy times found</b><ul style={{ paddingLeft: 16 }}>{clash.map((c, i) => <li key={i}>{dateTime(c.start, tz)} – {new Date(c.end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })} · {c.source}</li>)}</ul></div></div>}
        {!appointment && <>
          <Field id="bk-title" name="title" label="Title *" defaultValue="Discovery call" error={errs.title} />
          {!contactId && <SelectField key={contacts.data ? "l" : "x"} id="bk-contact" name="contactId" label="Contact *">{contacts.data?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>}
          <SelectField key={emps.length} id="bk-user" name="userId" label="Employee *" hint="Only employees with a connected Google Calendar can be booked." defaultValue={emps.find((e) => e.status === "connected")?.id}>
            {emps.map((e) => <option key={e.id} value={e.id} disabled={e.status !== "connected"}>{e.name}{e.status === "connected" ? "" : e.status === "needs_reconnect" ? " — calendar needs reconnecting" : " — no calendar connected"}</option>)}
          </SelectField>
        </>}
        <div className="grid g3">
          <Field id="bk-date" name="date" type="date" label="Date *" defaultValue={initStart.slice(0, 10)} required />
          <Field id="bk-time" name="time" type="time" label="Time *" defaultValue={initStart.slice(11, 16) || "15:00"} required error={errs.startLocal} />
          <SelectField id="bk-dur" name="duration" label="Duration" defaultValue={String(initDur)}>{[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</SelectField>
        </div>
        <SelectField id="bk-tz" label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</SelectField>
        <Note>Stored in UTC with this time zone, so it shows correctly for every viewer. The server reads the employee’s Google busy times before booking.</Note>
      </form>
    </Modal>
  );
}
