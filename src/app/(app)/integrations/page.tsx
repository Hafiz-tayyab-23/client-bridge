"use client";
import { useState } from "react";
import { CalendarDays, Check, CreditCard, History, Lock, MessageCircle, PlugZap, RefreshCw, TriangleAlert, Unplug, X } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { Btn, ErrorBox, Field, Ico, Loading, Modal, Note, PageHead, Pill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface Integration {
  provider: string; status: string; connectionId: string | null; config: Record<string, string | null>;
  lastSuccessAt: string | null; lastError: string | null; webhookUrl: string | null; limits: string[];
  recentErrors: { kind: string; error: string; created_at: string }[];
}
interface Ev { id: number; provider: string; direction: string; kind: string; status: string; reference: string | null; summary: string | null; error: string | null; created_at: string }

const META: Record<string, { name: string; cat: string; icon: React.ReactNode }> = {
  telegram: { name: "Telegram bot", cat: "Customer messaging (I1) + escalation alerts (I4)", icon: <MessageCircle size={16} /> },
  google: { name: "Google Calendar", cat: "Appointments (I3)", icon: <CalendarDays size={16} /> },
  safepay: { name: "Safepay", cat: "Payments (I2) · sandbox · proposed replacement", icon: <CreditCard size={16} /> },
};
const statusPill = (s: string) => s === "connected" ? <Pill tone="green" icon={<PlugZap size={12} />}>Connected</Pill> : s === "error" || s === "needs_reconnect" ? <Pill tone="red" icon={<TriangleAlert size={12} />}>{s === "error" ? "Error" : "Needs reconnect"}</Pill> : <Pill icon={<Unplug size={12} />}>Not connected</Pill>;

export default function IntegrationsPage() {
  const toast = useToast();
  const data = useApi<{ integrations: Integration[] }>("/api/integrations", { pollMs: 10000 });
  const events = useApi<{ events: Ev[] }>("/api/integrations/events", { pollMs: 10000 });
  const [connecting, setConnecting] = useState<"telegram" | "safepay" | null>(null);

  async function disconnect(p: string) {
    if (!confirm(`Disconnect ${p}? Its stored credentials are deleted.`)) return;
    try { await api(`/api/integrations/${p}`, { method: "DELETE" }); toast(`${p} disconnected`); data.reload(); events.reload(); refreshAll(); }
    catch (e) { toast((e as Error).message, "error"); }
  }

  return (
    <>
      <PageHead title="Integrations" sub="Real provider connections for this workspace only. Secrets are encrypted on the server and never shown." />
      {data.error && <ErrorBox>{data.error.message}</ErrorBox>}
      {!data.data ? <Loading /> : (
        <div className="grid g3">
          {data.data.integrations.filter((x) => x.provider !== "stripe").map((x) => {
            const m = META[x.provider];
            return (
              <section key={x.provider} className="card int" aria-label={m.name}>
                <header><h2><Ico tone={x.status === "error" ? "red" : undefined}>{m.icon}</Ico><span>{m.name}<small className="faint" style={{ display: "block", fontWeight: 500 }}>{m.cat}</small></span></h2>{statusPill(x.status)}</header>
                <div className="cb">
                  <dl className="kv">
                    <dt>Account</dt><dd>{x.config.botUsername ? `@${x.config.botUsername}` : x.config.accountName ?? x.config.accountId ?? "—"}</dd>
                    <dt>Last worked</dt><dd>{x.lastSuccessAt ? dateTime(x.lastSuccessAt) : "—"}</dd>
                    <dt>Credentials</dt><dd><Lock size={13} /> {x.status === "not_connected" ? "None stored" : "Stored encrypted, never shown"}</dd>
                    {x.webhookUrl && <><dt>Webhook</dt><dd><code>{x.webhookUrl.replace(/^https?:\/\//, "")}</code></dd></>}
                  </dl>
                  {x.lastError ? <div className="err"><TriangleAlert size={16} /><div><b>Most recent error</b><br />{x.lastError}</div></div> : x.status !== "not_connected" && <div className="faint"><Check size={13} /> No recent errors</div>}
                  {x.recentErrors.length > 1 && <ul className="faint" style={{ paddingLeft: 16 }}>{x.recentErrors.slice(1, 4).map((e, i) => <li key={i}>{dateTime(e.created_at)} · {e.kind}: {e.error}</li>)}</ul>}
                  {x.limits.map((l) => <Note key={l}>{l}</Note>)}
                  <div className="row wrap" style={{ marginTop: "auto" }}>
                    {x.provider === "google" ? <a className="btn" href="/calendar"><CalendarDays size={14} />Per-employee connections on Calendar</a> : <>
                      <Btn variant={x.status === "connected" ? undefined : "pri"} onClick={() => setConnecting(x.provider as "telegram" | "safepay")}><RefreshCw size={14} />{x.status === "not_connected" ? "Connect" : "Reconnect"}</Btn>
                      {x.status !== "not_connected" && <Btn variant="dng" onClick={() => disconnect(x.provider)}><Unplug size={14} />Disconnect</Btn>}
                    </>}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <section className="card mt"><header><h2><History size={16} />Synchronization history</h2><span className="faint">Every inbound webhook and outbound call</span></header>
        {!events.data ? <Loading /> : events.data.events.length === 0 ? <div className="empty">No provider traffic yet.</div> : (
          <div className="tw"><table className="stk"><thead><tr><th scope="col">Time</th><th scope="col">Provider</th><th scope="col">Direction</th><th scope="col">Event</th><th scope="col">Result</th><th scope="col">Reference / detail</th></tr></thead>
            <tbody>{events.data.events.filter((e) => e.provider !== "stripe").map((e) => (
              <tr key={e.id}><td data-l="Time" className="num">{dateTime(e.created_at)}</td><td data-l="Provider"><b>{e.provider}</b></td><td data-l="Direction">{e.direction}</td><td data-l="Event">{e.kind}</td>
                <td data-l="Result">{e.status === "ok" ? <Pill tone="green" icon={<Check size={12} />}>OK</Pill> : e.status === "duplicate" ? <Pill tone="blue">Duplicate ignored</Pill> : e.status === "retrying" ? <Pill tone="amber">Retrying</Pill> : <Pill tone="red" icon={<X size={12} />}>{e.status === "rejected" ? "Rejected" : "Failed"}</Pill>}</td>
                <td data-l="Detail"><small>{e.error ?? e.summary ?? ""}</small><code>{e.reference?.slice(0, 28) ?? ""}</code></td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      {connecting && <ConnectModal provider={connecting} onClose={() => setConnecting(null)} onDone={() => { setConnecting(null); data.reload(); events.reload(); refreshAll(); }} />}
    </>
  );
}

function ConnectModal({ provider, onClose, onDone }: { provider: "telegram" | "safepay"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const body = provider === "safepay" ? { apiKey: f.get("apiKey"), secretKey: f.get("secretKey"), webhookSecret: f.get("webhookSecret") }
        : { botToken: f.get("botToken") };
      const r = await api<{ webhookNote?: string; note?: string }>(`/api/integrations/${provider}`, { method: "PUT", body });
      toast(`Connected. ${r.webhookNote ?? r.note ?? ""}`); onDone();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <Modal title={provider === "safepay" ? "Connect Safepay (sandbox)" : "Connect Telegram bot"} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="cn">Verify & connect</Btn></>}>
      <form id="cn" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        {provider === "safepay" ? <>
          <Field id="spk" name="apiKey" type="password" autoComplete="off" label="Public API Key *" hint="Safepay dashboard → Developers → API (sandbox). Starts with sec_." />
          <Field id="sps" name="secretKey" type="password" autoComplete="off" label="Private API Secret Key *" hint="Same page. Verified by requesting a Safepay passport token." />
          <Field id="spw" name="webhookSecret" type="password" autoComplete="off" label="Private Webhook Secret Key" hint="Developers → Endpoints → View shared secret. Add the endpoint shown on this card after connecting." />
        </> : <>
          <Field id="bt" name="botToken" type="password" autoComplete="off" label="Bot token from @BotFather *" hint="The server verifies it and registers a webhook protected by a random secret token." />
        </>}
        <Note>The key is verified with the provider, encrypted, and never sent back to the browser. This change is recorded in the audit log.</Note>
      </form>
    </Modal>
  );
}
