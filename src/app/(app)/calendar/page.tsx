"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, CalendarPlus, CalendarX, Link2, Unplug, Users } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { useCan, useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Loading, Note, PageHead, Pill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { BookModal } from "@/components/calendar/book-modal";

interface Appt { id: string; title: string; starts_at: string; ends_at: string; timezone: string; status: string; provider_event: string | null; user_id: string; user_name: string | null; contact_id: string | null; contact_name: string | null }
interface Cal { configured: boolean; employees: { id: string; name: string; status: string; email: string | null; last_error: string | null }[]; appointments: Appt[] }

function CalendarScreen() {
  const me = useMe();
  const can = useCan();
  const toast = useToast();
  const sp = useSearchParams();
  const router = useRouter();
  const cal = useApi<Cal>("/api/calendar", { pollMs: 15000 });
  const [booking, setBooking] = useState(false);
  const [resched, setResched] = useState<Appt | null>(null);
  useEffect(() => {
    if (sp.get("google") === "connected") { toast(`Google Calendar connected${sp.get("email") ? ` (${sp.get("email")})` : ""}`); router.replace("/calendar"); }
    if (sp.get("google_error")) { toast(sp.get("google_error")!, "error"); }
  }, [sp, router, toast]);

  async function cancel(a: Appt) {
    if (!confirm(`Cancel “${a.title}” with ${a.contact_name}? The Google Calendar event is deleted.`)) return;
    try { await api(`/api/appointments/${a.id}`, { method: "DELETE" }); toast("Cancelled — removed from Google Calendar"); refreshAll(); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  async function disconnect() {
    if (!confirm("Disconnect your Google Calendar? Access is revoked with Google.")) return;
    try { await api("/api/integrations/google", { method: "DELETE" }); toast("Google Calendar disconnected"); cal.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }

  if (cal.error) return <><PageHead title="Calendar" /><ErrorBox>{cal.error.message}</ErrorBox></>;
  if (!cal.data) return <><PageHead title="Calendar" /><Loading /></>;
  const mine = cal.data.employees.find((e) => e.id === me.user.id);
  const days = new Map<string, Appt[]>();
  for (const a of cal.data.appointments) {
    const k = new Date(a.starts_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: me.workspace.timezone });
    days.set(k, [...(days.get(k) ?? []), a]);
  }
  const googleErr = sp.get("google_error");

  return (
    <>
      <PageHead title="Calendar" sub={`Appointments on employees’ real Google Calendars. Times shown in ${me.workspace.timezone}.`}
        actions={can("crm.edit") && <Btn variant="pri" onClick={() => setBooking(true)}><CalendarPlus size={16} />Book appointment</Btn>} />
      {!cal.data.configured && <div className="banner red card" style={{ borderRadius: "var(--r)", marginBottom: 16 }}><CalendarX size={16} /><span><b>Google OAuth is not configured on the server.</b> Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the hosting settings and redeploy.</span></div>}
      {googleErr && <div style={{ marginBottom: 16 }}><ErrorBox>{googleErr}</ErrorBox></div>}
      <div className={`banner ${mine?.status === "connected" ? "blue" : "amber"} card`} style={{ borderRadius: "var(--r)", marginBottom: 16 }}>
        {mine?.status === "connected" ? <CalendarCheck size={16} /> : <CalendarX size={16} />}
        <span>{mine?.status === "connected" ? <>Your Google Calendar is connected{mine.email ? ` (${mine.email})` : ""}.</> : mine?.status === "needs_reconnect" ? <>Your Google connection expired or was revoked: {mine.last_error}</> : <>Your Google Calendar is not connected. You cannot be booked until you connect it.</>}</span>
        <span className="row" style={{ marginLeft: "auto" }}>
          {mine?.status !== "connected" && <a className="btn sm pri" href="/api/integrations/google/connect"><Link2 size={14} />{mine?.status === "needs_reconnect" ? "Reconnect" : "Connect Google Calendar"}</a>}
          {mine?.status === "connected" && <Btn size="sm" onClick={disconnect}><Unplug size={14} />Disconnect</Btn>}
        </span>
      </div>
      <div className="grid r21">
        <section className="card"><header><h2><CalendarDays size={16} />Upcoming appointments</h2></header>
          {days.size === 0 ? <div className="empty">No appointments in the next 60 days.</div> : [...days.entries()].map(([day, list]) => (
            <div key={day}><div className="faint" style={{ padding: "10px 18px 0", fontWeight: 600 }}>{day}</div>
              <ul className="list">{list.map((a) => (
                <li key={a.id}>
                  <span className="tm">{new Date(a.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: me.workspace.timezone })}</span>
                  <div className="grow"><b>{a.contact_name ?? a.title}</b><span>{a.title} · {a.user_name} · booked in {a.timezone}{a.timezone !== me.workspace.timezone ? ` (${dateTime(a.starts_at, a.timezone)} there)` : ""}</span></div>
                  {a.status === "cancelled" ? <Pill tone="gray">Cancelled</Pill> : <div className="row" style={{ gap: 4 }}>
                    <Pill tone="green">Synced to Google</Pill>
                    <Btn size="sm" onClick={() => setResched(a)}>Reschedule</Btn>
                    <Btn size="sm" variant="dng" onClick={() => cancel(a)}>Cancel</Btn>
                  </div>}
                </li>))}</ul></div>
          ))}
        </section>
        <section className="card"><header><h2><Users size={16} />Who can be booked</h2></header>
          <ul className="list">{cal.data.employees.map((e) => (
            <li key={e.id}><div className="grow"><b>{e.name}</b><span>{e.status === "connected" ? `Calendar connected${e.email ? ` · ${e.email}` : ""}` : e.status === "needs_reconnect" ? "Needs reconnecting — cannot be booked" : "No calendar connected — cannot be booked"}</span></div>
              {e.status === "connected" ? <Pill tone="green">Bookable</Pill> : <Pill tone="amber">Not bookable</Pill>}</li>
          ))}</ul>
          <div className="cb"><Note>Each employee connects their own Google account. Tokens are stored encrypted on the server and refreshed automatically.</Note></div>
        </section>
      </div>
      {booking && <BookModal onClose={() => setBooking(false)} />}
      {resched && <BookModal appointment={resched} onClose={() => setResched(null)} />}
    </>
  );
}

export default function CalendarPage() {
  return <Suspense fallback={<Loading />}><CalendarScreen /></Suspense>;
}
