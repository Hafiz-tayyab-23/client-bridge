"use client";
import { CalendarX } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { Loading, Note, PageHead } from "@/components/ui/primitives";

// I3 (Google Calendar OAuth) is not implemented in this build. This screen states that honestly
// and lists any appointments stored in the platform; it never fakes bookings or conflicts.
export default function CalendarPage() {
  const d = useApi<{ upcoming_appointments: { id: string; title: string; starts_at: string; contact_name: string | null; user_name: string | null }[]; timezone: string }>("/api/dashboard");
  return (
    <>
      <PageHead title="Calendar" sub="Appointments linked to employees’ Google Calendars." />
      <div className="banner red card" style={{ borderRadius: "var(--r)", marginBottom: 16 }}><CalendarX size={16} /><span><b>Google Calendar is not connected in this build.</b> OAuth connection, busy-time checks, booking, rescheduling and cancellation (I3.1–I3.7) were not implemented, so booking is disabled rather than simulated.</span></div>
      <section className="card"><header><h2>Upcoming appointments</h2></header>
        {!d.data ? <Loading /> : d.data.upcoming_appointments.length === 0 ? <div className="empty">No appointments stored.</div> : (
          <ul className="list">{d.data.upcoming_appointments.map((a) => <li key={a.id}><span className="tm">{dateTime(a.starts_at, d.data!.timezone)}</span><div className="grow"><b>{a.contact_name ?? a.title}</b><span>{a.title} · {a.user_name}</span></div></li>)}</ul>
        )}
        <div className="cb"><Note>Required setup to enable this: a Google Cloud OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) with the Calendar API, plus the server-side OAuth flow.</Note></div>
      </section>
    </>
  );
}
