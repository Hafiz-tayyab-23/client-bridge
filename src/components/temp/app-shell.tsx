"use client";
// TEMPORARY shell: navigation, availability, realtime notifications. Logic lives in the API.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { TempBanner } from "./ui";

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

interface Note { id: string; title: string; body: string; link: string | null; created_at: string }

export function AppShell({ me, availability: initial, children }: { me: Me; availability: string; children: React.ReactNode }) {
  const router = useRouter();
  const [availability, setAvailability] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const since = useRef<string | null>(null);
  const perms = new Set(me.user.permissions);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const r = await api<{ notifications: Note[]; serverTime: string }>(`/api/events${q}`);
        if (since.current && r.notifications.length) {
          setNotes((n) => [...r.notifications, ...n].slice(0, 5));
          window.dispatchEvent(new CustomEvent("app:refresh"));
        }
        since.current = r.serverTime;
      } catch { /* offline; retry next tick */ }
      if (!stop) setTimeout(poll, 4000);
    }
    poll();
    return () => { stop = true; };
  }, []);

  async function changeAvailability(v: string) {
    setStatus("Saving…");
    try {
      const r = await api<{ reassigned: number }>(`/api/team/users/${me.user.id}/availability`, { method: "PUT", body: { availability: v } });
      setAvailability(v);
      setStatus(r.reassigned ? `Saved. ${r.reassigned} unacknowledged lead(s) reassigned.` : "Saved.");
      window.dispatchEvent(new CustomEvent("app:refresh"));
    } catch (e) { setStatus(`Could not save: ${(e as Error).message}`); }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login"); router.refresh();
  }

  return (
    <MeContext.Provider value={me}>
      <TempBanner />
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <strong>{me.workspace.name}</strong>
          <nav aria-label="Main" className="flex flex-wrap gap-3 text-sm">
            <Link className="underline" href="/">Home</Link>
            <Link className="underline" href="/leads">Leads</Link>
            <Link className="underline" href="/leads/recovery">Recovery queue</Link>
            <Link className="underline" href="/team">Team</Link>
            {perms.has("assignment.manage") && <Link className="underline" href="/settings/assignment">Assignment rules</Link>}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="avail">My status</label>
            <select id="avail" value={availability} onChange={(e) => changeAvailability(e.target.value)} className="rounded border px-2 py-1">
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="on_leave">On leave</option>
              <option value="offline">Offline</option>
            </select>
            <span>{me.user.name} ({me.user.baseRole})</span>
            <button onClick={logout} className="underline">Log out</button>
          </div>
        </div>
        {status && <p role="status" className="mx-auto max-w-6xl px-4 pb-2 text-sm">{status}</p>}
      </header>
      <div aria-live="polite" className="fixed bottom-4 right-4 z-10 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {notes.map((n) => (
          <div key={n.id} className="rounded border border-neutral-400 bg-white p-3 text-sm shadow">
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <div className="mt-1 flex gap-3">
              {n.link && <Link className="underline" href={n.link}>Open</Link>}
              <button className="underline" onClick={() => setNotes((x) => x.filter((y) => y.id !== n.id))}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </MeContext.Provider>
  );
}
