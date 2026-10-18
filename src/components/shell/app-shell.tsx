"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Bell, Building2, CalendarDays, ContactRound, CreditCard, Inbox, LayoutDashboard, LogOut, Menu, MessagesSquare,
  PlugZap, ScrollText, Search, Settings, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { refreshAll, useApi } from "@/lib/hooks";
import { ago, availLabel } from "@/lib/format";
import { Avatar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const useCan = () => { const me = useMe(); return (p: string) => me.user.permissions.includes(p); };

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; perm?: string };
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/crm", label: "CRM", icon: ContactRound, perm: "crm.view" },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare, perm: "crm.view" },
  { href: "/payments", label: "Payments", icon: CreditCard, perm: "crm.view" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/team", label: "Team", icon: Users },
  { href: "/integrations", label: "Integrations", icon: PlugZap, perm: "integrations.manage" },
  { href: "/audit", label: "Audit Log", icon: ScrollText, perm: "audit.view" },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface Note { id: string; title: string; body: string; link: string | null; created_at: string; read_at: string | null }

export function AppShell({ me, availability: initial, children }: { me: Me; availability: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const perms = new Set(me.user.permissions);
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(initial);
  const [savingAvail, setSavingAvail] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bell, setBell] = useState(false);
  const since = useRef<string | null>(null);
  const summary = useApi<{ counts: { recovery: number; overdue: number } }>("/api/leads/summary", { pollMs: 10000 });
  const intsRaw = useApi<{ integrations: { provider: string; status: string }[] }>(perms.has("integrations.manage") ? "/api/integrations" : null);
  const ints = { data: intsRaw.data ? { integrations: intsRaw.data.integrations.filter((i) => i.provider !== "stripe") } : null };

  // Realtime awareness (Q11): poll for new notifications; any change refreshes open views.
  useEffect(() => {
    let stop = false;
    (async function poll() {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const r = await api<{ notifications: Note[]; serverTime: string }>(`/api/events${q}`);
        if (since.current === null) setNotes(r.notifications);
        else if (r.notifications.length) {
          setNotes((n) => [...r.notifications, ...n].slice(0, 30));
          r.notifications.slice(0, 2).forEach((n) => toast(n.title));
        }
        since.current = r.serverTime;
        refreshAll();
      } catch { /* network blip: retry */ }
      if (!stop) setTimeout(poll, 4000);
    })();
    return () => { stop = true; };
  }, [toast]);

  useEffect(() => setOpen(false), [path]);

  async function changeAvailability(v: string) {
    const prev = availability;
    setAvailability(v); setSavingAvail(true);
    try {
      const r = await api<{ reassigned: number }>(`/api/team/users/${me.user.id}/availability`, { method: "PUT", body: { availability: v } });
      toast(r.reassigned ? `Status: ${availLabel(v)}. ${r.reassigned} unacknowledged lead(s) reassigned.` : `Status: ${availLabel(v)}`);
      refreshAll();
    } catch (e) { setAvailability(prev); toast(`Could not change status: ${(e as Error).message}`, "error"); }
    finally { setSavingAvail(false); }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login"); router.refresh();
  }

  async function openBell() {
    setBell((b) => !b);
    if (notes.some((n) => !n.read_at)) {
      await api("/api/notifications", { method: "POST" }).catch(() => {});
      setNotes((n) => n.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    }
  }

  const unread = notes.filter((n) => !n.read_at).length;
  const attention = summary.data ? summary.data.counts.recovery : 0;
  const bad = ints.data?.integrations.filter((i) => i.status === "error" || i.status === "needs_reconnect").length ?? 0;
  const connected = ints.data?.integrations.filter((i) => i.status === "connected").length ?? 0;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <MeCtx.Provider value={me}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="app">
        <aside className={`side ${open ? "open" : ""}`} id="side" aria-label="Primary">
          <div className="brand">
            <span className="logo" style={{ background: "#fff" }}><img src="/clientbridge-mark.png" alt="" width={28} height={28} /></span>
            <div><b>ClientBridge</b><small>{me.workspace.name}</small></div>
          </div>
          <nav className="nav" aria-label="Main navigation">
            {NAV.filter((n) => !n.perm || perms.has(n.perm)).map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
                <n.icon size={16} />{n.label}
                {n.href === "/leads" && attention > 0 && <span className="badge" aria-label={`${attention} in recovery queue`}>{attention}</span>}
              </Link>
            ))}
          </nav>
          {ints.data && (
            <div className="side-foot">
              <span className="dot" style={{ background: bad ? "#e5484d" : connected ? "#34d399" : "#9aa1b5" }} aria-hidden="true" />
              {bad ? `${bad} integration${bad > 1 ? "s" : ""} need attention` : `${connected} of ${ints.data.integrations.length} integrations connected`}
            </div>
          )}
        </aside>
        <div className={`scrim ${open ? "show" : ""}`} onClick={() => setOpen(false)} />
        <div className="main">
          <header className="top">
            <button className="ibtn menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation" aria-controls="side"><Menu size={16} /></button>
            <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); router.push(`/crm?q=${encodeURIComponent(String(q ?? ""))}`); }}>
              <Search size={16} />
              <label className="sr" htmlFor="gs">Search contacts</label>
              <input id="gs" name="q" placeholder="Search contacts by name, email or phone…" autoComplete="off" />
            </form>
            <div className="top-r">
              <span className="ws"><Building2 size={16} /><span>{me.workspace.name}</span></span>
              <label className="sr" htmlFor="avail">My availability</label>
              <select id="avail" className="avail" value={availability} disabled={savingAvail} onChange={(e) => changeAvailability(e.target.value)}>
                <option value="available">● Available</option>
                <option value="busy">● Busy</option>
                <option value="on_leave">● On leave</option>
                <option value="offline">● Offline</option>
              </select>
              <div style={{ position: "relative" }}>
                <button className="ibtn" onClick={openBell} aria-expanded={bell} aria-label={`Notifications, ${unread} unread`}>
                  <Bell size={16} />{unread > 0 && <span className="n">{unread}</span>}
                </button>
                {bell && (
                  <div className="card notes" role="dialog" aria-label="Notifications">
                    <header className="ch"><h2>Notifications</h2><button className="link" onClick={() => setBell(false)}>Close</button></header>
                    {notes.length === 0 ? <div className="empty">No notifications yet.</div> : (
                      <ul className="list" style={{ maxHeight: 360, overflow: "auto" }}>
                        {notes.map((n) => (
                          <li key={n.id}><div className="grow"><b style={{ whiteSpace: "normal" }}>{n.title}</b><span style={{ whiteSpace: "normal" }}>{n.body}</span><span>{ago(n.created_at)}</span></div>
                            {n.link && <Link className="link" href={n.link} onClick={() => setBell(false)}>Open</Link>}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="me"><Avatar name={me.user.name} /><div><b>{me.user.name}</b><small style={{ textTransform: "capitalize" }}>{me.user.baseRole}</small></div></div>
              <button className="ibtn" onClick={logout} aria-label="Log out" title="Log out"><LogOut size={16} /></button>
            </div>
          </header>
          <main className="content" id="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </MeCtx.Provider>
  );
}
