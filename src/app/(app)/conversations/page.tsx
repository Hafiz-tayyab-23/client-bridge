"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Ban, CircleAlert, CircleHelp, ContactRound, Info, RefreshCw, Search, Send } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { ago, dateTime } from "@/lib/format";
import { Avatar, Btn, ErrorBox, Loading, Note, PageHead, Pill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface Conv { id: string; channel: string; contact_id: string; contact_name: string; opted_out: boolean; known_telegram: boolean; assignee_name: string | null; last_message_at: string; unread: boolean; last_body: string | null; last_direction: string | null; has_failed: boolean }
interface Msg { id: string; direction: "inbound" | "outbound"; body: string; status: string; error_message: string | null; created_at: string; sender_name: string | null }
interface Thread { conversation: { id: string; contact_id: string; contact_name: string; opted_out: boolean; opted_out_at: string | null; telegram_chat_id: string | null; assignee_name: string | null }; messages: Msg[] }

const statusLabel = (m: Msg) => m.direction === "inbound" ? "Received" : m.status === "sent" ? "Sent · Telegram does not report delivery" : m.status === "sending" ? "Sending…" : m.status === "failed" ? "Failed" : m.status;

function Conversations() {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sel = sp.get("id");
  const contact = sp.get("contact");
  const list = useApi<{ conversations: Conv[] }>(`/api/conversations?filter=${filter}&q=${encodeURIComponent(q)}`, { pollMs: 4000 });
  const thread = useApi<Thread>(sel ? `/api/conversations/${sel}` : null, { pollMs: 4000 });
  const msgsRef = useRef<HTMLDivElement>(null);

  // Opening from a CRM contact: find or create its Telegram conversation.
  useEffect(() => {
    if (!contact || sel) return;
    api<{ id: string }>("/api/conversations", { body: { contactId: contact } })
      .then((r) => router.replace(`/conversations?id=${r.id}`))
      .catch((e) => toast((e as Error).message, "error"));
  }, [contact, sel, router, toast]);
  useEffect(() => { msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight); }, [thread.data?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!sel || !text.trim()) return;
    setBusy("send");
    try {
      const r = await api<{ status: string; error: string | null }>(`/api/conversations/${sel}/messages`, { body: { text } });
      setText("");
      if (r.status === "failed") toast(`Not delivered: ${r.error}`, "error"); else toast("Sent to Telegram");
      thread.reload(); refreshAll();
    } catch (err) { toast((err as Error).message, "error"); }
    finally { setBusy(null); }
  }
  async function retry(id: string) {
    setBusy(id);
    try { const r = await api<{ status: string; error: string | null }>(`/api/messages/${id}/retry`, { method: "POST" }); toast(r.status === "sent" ? "Re-sent" : `Still failing: ${r.error}`, r.status === "sent" ? "ok" : "error"); thread.reload(); }
    catch (err) { toast((err as Error).message, "error"); }
    finally { setBusy(null); }
  }
  const t = thread.data?.conversation;
  const failed = thread.data?.messages.filter((m) => m.status === "failed").at(-1);

  return (
    <>
      <PageHead title="Conversations" sub="Customer messaging through a Telegram bot (organizer-approved replacement for Twilio), linked to CRM records and assigned owners." />
      <div style={{ marginBottom: 12 }}><Note>Telegram limits: the bot can only message people who have messaged it first, and Telegram does not report delivered or read status — messages show as Sent or Failed. Unknown senders automatically become a contact and a lead.</Note></div>
      <div className="card chat">
        <div className="cl">
          <div className="fbar" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div className="search" style={{ maxWidth: "none" }}><Search size={16} /><label className="sr" htmlFor="mq">Search conversations</label><input id="mq" placeholder="Search by contact" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chips" role="group" aria-label="Filter conversations">
              {[["all", "All"], ["unread", "Unread"], ["failed", "Failed"], ["unassigned", "Unassigned"], ["optout", "Opted out"]].map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </div>
          <ul>
            {!list.data ? <li style={{ listStyle: "none" }}><Loading /></li> : list.data.conversations.length === 0 ? <li className="empty" style={{ listStyle: "none" }}>No conversations yet. Customers start one by messaging your Telegram bot.</li> :
              list.data.conversations.map((c) => (
                <li key={c.id} style={{ listStyle: "none" }}>
                  <button className="ci" aria-current={c.id === sel} onClick={() => router.replace(`/conversations?id=${c.id}`)}>
                    <Avatar name={c.contact_name} />
                    <div className="grow"><div className="row" style={{ gap: 6 }}><b>{c.contact_name}</b><span className="t">{ago(c.last_message_at)}</span></div>
                      <p>{c.last_direction === "outbound" ? "You: " : ""}{c.last_body ?? "No messages yet"}</p>
                      <div className="row" style={{ gap: 5, marginTop: 5 }}><Pill tone="blue">Telegram</Pill>{c.opted_out && <Pill tone="red" icon={<Ban size={12} />}>Opted out</Pill>}{c.has_failed && <Pill tone="red" icon={<CircleAlert size={12} />}>Failed</Pill>}{!c.known_telegram && <Pill tone="amber" icon={<CircleHelp size={12} />}>No Telegram chat</Pill>}{c.unread && <span className="unread" style={{ marginLeft: "auto" }}>new</span>}</div>
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        </div>
        <div className="thread">
          {!sel ? <div className="empty" style={{ margin: "auto" }}>Select a conversation.</div> : thread.error ? <div className="cb"><ErrorBox>{thread.error.message}</ErrorBox></div> : !t ? <Loading /> : (
            <>
              <div className="row between" style={{ padding: "12px 18px", background: "#fff", borderBottom: "1px solid var(--line)" }}>
                <div className="row"><Avatar name={t.contact_name} /><div><b>{t.contact_name}</b><div className="faint">Telegram · {t.assignee_name ? `Assigned to ${t.assignee_name}` : "Unassigned"}</div></div></div>
                <Link className="btn sm" href={`/crm/contacts/${t.contact_id}`}><ContactRound size={14} />CRM record</Link>
              </div>
              {t.opted_out && <div className="banner red"><Ban size={16} /><span>{t.contact_name} opted out{t.opted_out_at ? ` on ${dateTime(t.opted_out_at)}` : ""}. Sending is blocked to respect their choice.</span></div>}
              {!t.telegram_chat_id && <div className="banner amber"><CircleHelp size={16} /><span>This contact has never messaged the bot, so Telegram does not allow the bot to message them yet.</span></div>}
              {failed && <div className="banner red"><CircleAlert size={16} /><span>Last failure: {failed.error_message}</span></div>}
              <div className="msgs" ref={msgsRef} aria-live="polite">
                {thread.data!.messages.length === 0 && <div className="sysmsg">No messages yet</div>}
                {thread.data!.messages.map((m) => (
                  <div key={m.id} className={`msg ${m.direction === "outbound" ? "out" : ""} ${m.status === "failed" ? "fail" : ""}`}>
                    {m.body}
                    <small>{dateTime(m.created_at)} · {statusLabel(m)}{m.sender_name ? ` · ${m.sender_name}` : ""}
                      {m.status === "failed" && <Btn size="sm" style={{ marginLeft: 6 }} busy={busy === m.id} disabled={t.opted_out} onClick={() => retry(m.id)}><RefreshCw size={12} />Retry</Btn>}</small>
                  </div>
                ))}
              </div>
              <form className="comp" onSubmit={send}>
                <label className="sr" htmlFor="cmp">Message</label>
                <input className="inp" id="cmp" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.opted_out ? "Messaging disabled: contact opted out" : "Type a message…"} disabled={t.opted_out} />
                <Btn variant="pri" busy={busy === "send"} disabled={t.opted_out || !text.trim()} type="submit"><Send size={16} />Send</Btn>
              </form>
            </>
          )}
        </div>
        <aside className="cs" aria-label="About this channel"><h3 style={{ fontSize: 13, marginBottom: 12 }}>How it works</h3>
          <div className="note"><Info size={15} /><span>Messages are stored on the CRM record and appear in the contact’s activity history. Replying counts as acting on the contact’s open lead.</span></div>
          <p className="faint" style={{ marginTop: 12 }}>Customers send <code>/stop</code> to opt out. Employees send <code>/start</code> to get their chat ID for escalation alerts.</p>
        </aside>
      </div>
    </>
  );
}

export default function ConversationsPage() {
  return <Suspense fallback={<Loading />}><Conversations /></Suspense>;
}
