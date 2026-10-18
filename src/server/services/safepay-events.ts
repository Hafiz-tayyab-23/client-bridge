import "server-only";
import { sql } from "../db";
import { AppError, badRequest, notFound } from "../http";
import { activity } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { firstReceipt, getConnection, getConnectionById, markHealth, recordEvent, secretsOf } from "../integrations/store";
import { fetchTracker, findField, mapTrackerState, shapeOf, verifySafepayWebhook } from "../integrations/safepay";
import { applyStatus, type Status } from "./payments";

type SpSecrets = { apiKey: string; secretKey: string; webhookSecret?: string };
interface SpEvent { token?: string; type?: string; data?: { tracker?: string; state?: string; amount?: number; currency?: string; metadata?: Record<string, string> } }
type Pay = Record<string, unknown> & { id: string; workspace_id: string; amount_cents: number; currency: string; provider_session: string; refunded_cents: number; status: string; contact_id: string | null; opportunity_id: string | null };

/**
 * Confirms a tracker with Safepay's reporter API (authenticated with the secret key) and checks that the
 * provider's tracker, amount and currency match our payment exactly. Nothing is recorded unless this passes.
 */
async function confirmWithProvider(secretKey: string, pay: Pay) {
  const r = await fetchTracker(secretKey, pay.provider_session);
  if (!r.ok) return { ok: false, temporary: !r.permanent, reason: r.error ?? "Safepay status check failed", state: undefined as string | undefined, shape: "" };
  // Field paths observed on the live sandbox reporter API (GET /reporter/api/v1/payments/{tracker}).
  const d = (r.data ?? {}) as { token?: string; state?: string; metadata?: { order_id?: { value?: string } }; purchase_totals?: { quote_amount?: { amount?: number; currency?: string } } };
  const state = d.state ?? (findField(d, ["state"]) as string | undefined);
  const token = d.token;
  const amount = d.purchase_totals?.quote_amount?.amount;
  const currency = d.purchase_totals?.quote_amount?.currency;
  const orderRef = d.metadata?.order_id?.value;
  const shape = shapeOf(d).join(",");
  const problems: string[] = [];
  if (token !== pay.provider_session) problems.push("tracker mismatch");
  if (orderRef !== undefined && orderRef !== pay.id) problems.push("order reference mismatch");
  if (amount === undefined) problems.push("provider response has no amount");
  else if (Number(amount) !== Number(pay.amount_cents)) problems.push(`amount mismatch (provider ${amount}, expected ${pay.amount_cents} minor units)`);
  if (!currency) problems.push("provider response has no currency");
  else if (currency.toLowerCase() !== pay.currency.toLowerCase()) problems.push(`currency mismatch (provider ${currency}, expected ${pay.currency.toUpperCase()})`);
  return { ok: problems.length === 0, temporary: false, state, shape, reason: problems.join("; ") };
}

/** Webhook: documented signature verified first; each event processed once; payment recorded only after provider confirmation. */
export async function handleSafepayWebhook(connectionId: string, rawBody: string, signature: string | null) {
  const conn = await getConnectionById(connectionId);
  if (!conn || conn.provider !== "safepay") throw notFound();
  const secrets = secretsOf<SpSecrets>(conn);
  const ws = conn.workspace_id;
  if (!secrets?.webhookSecret) {
    await recordEvent(sql, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: "webhook", status: "rejected", error: "No webhook secret configured" });
    throw badRequest("Webhook secret not configured.");
  }
  const v = verifySafepayWebhook(rawBody, signature, secrets.webhookSecret, [secrets.secretKey, secrets.apiKey]);
  if (!v.ok) {
    await recordEvent(sql, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: "webhook", status: "rejected", error: v.reason });
    throw new AppError(400, "invalid_signature", v.reason ?? "Invalid signature");
  }
  const ev = JSON.parse(rawBody) as SpEvent;
  const tracker = ev.data?.tracker;
  const eventId = ev.token ?? `${tracker}:${ev.type}:${ev.data?.state}`;
  const [already] = await sql`select 1 from webhook_receipts where provider = 'safepay' and event_id = ${`${ws}:${eventId}`}`;
  if (already) {
    await recordEvent(sql, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: ev.type ?? "event", status: "duplicate", reference: eventId });
    return { duplicate: true };
  }
  const [p] = tracker ? await sql`select * from payments where provider = 'safepay' and provider_session = ${tracker} and workspace_id = ${ws}` : [];
  if (!p) {
    await recordEvent(sql, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: ev.type ?? "event", status: "ok", reference: eventId, summary: `No matching payment for tracker ${tracker ?? "?"}; ignored` });
    return { received: true, matched: false };
  }
  const pay = p as Pay;
  const refProblems: string[] = [];
  const metaRef = ev.data?.metadata?.order_id ?? ev.data?.metadata?.payment_id;
  if (metaRef && metaRef !== pay.id) refProblems.push("order reference (metadata.order_id) does not match");
  if (ev.type === "payment.succeeded") {
    if (ev.data?.amount !== undefined && Number(ev.data.amount) !== Number(pay.amount_cents)) refProblems.push(`webhook amount ${ev.data.amount} does not equal expected ${pay.amount_cents}`);
    if (ev.data?.currency && ev.data.currency.toLowerCase() !== pay.currency.toLowerCase()) refProblems.push(`webhook currency ${ev.data.currency} does not equal ${pay.currency.toUpperCase()}`);
  }
  let target: Status | null = null;
  let refunded: number | undefined;
  let note = "";
  if (refProblems.length) note = `Not recorded: ${refProblems.join("; ")}`;
  else if (ev.type === "payment.failed") target = "failed";
  else if (ev.type === "payment.succeeded" || ev.type === "payment.refunded" || ev.data?.state) {
    const c = await confirmWithProvider(secrets.secretKey, pay);
    if (!c.ok && c.temporary) {
      await recordEvent(sql, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: ev.type ?? "event", status: "retrying", reference: eventId, error: `Could not confirm with Safepay: ${c.reason}` });
      throw new AppError(503, "provider_unavailable", "Could not confirm with Safepay; please retry.");
    }
    if (!c.ok) note = `Not recorded: ${c.reason} (response fields: ${c.shape})`;
    else {
      const mapped = mapTrackerState(c.state);
      if (ev.type === "payment.succeeded" && mapped !== "paid") note = `Not recorded: Safepay reports state ${c.state ?? "unknown"}, not TRACKER_ENDED`;
      else if (mapped === "refunded") { target = "refunded"; refunded = Number(pay.amount_cents); }
      else if (mapped === "partially_refunded") {
        const evAmt = Number(ev.data?.amount);
        if (Number.isFinite(evAmt) && evAmt > 0 && evAmt < Number(pay.amount_cents)) { target = "partially_refunded"; refunded = evAmt; }
        else note = "Not recorded: partial refund confirmed by Safepay but the refunded amount was not provided";
      } else target = mapped;
    }
  }
  const rejected = note.startsWith("Not recorded");
  return sql.begin(async (tx) => {
    if (!(await firstReceipt(tx, "safepay", `${ws}:${eventId}`))) return { duplicate: true };
    const [row] = await tx`select * from payments where id = ${pay.id} for update`;
    const changed = target ? await applyStatus(tx, row as never, target, { refunded }) : false;
    await recordEvent(tx, { workspaceId: ws, provider: "safepay", direction: "inbound", kind: ev.type ?? "event", status: rejected ? "error" : "ok", reference: eventId,
      summary: `${changed ? "Payment updated" : "No change"} · signature: ${v.variant}${note ? ` · ${note}` : ""}`, error: rejected ? note : null });
    await markHealth(tx, conn.id, true);
    return { received: true, matched: true, changed, recorded: !rejected };
  });
}

/** Authenticated server-to-Safepay status check (covers cancel/expiry, which have no documented webhook). */
export async function syncSafepayPayment(actor: Actor, paymentId: string) {
  requirePerm(actor, "crm.view");
  const mine = can(actor, "crm.view_all") ? null : actor.id;
  const [p] = await sql`select * from payments where id = ${paymentId} and workspace_id = ${actor.workspaceId} and provider = 'safepay' ${mine ? sql`and requested_by = ${mine}` : sql``}`;
  if (!p) throw notFound("Safepay payment not found.");
  const conn = await getConnection(sql, actor.workspaceId, "safepay");
  const s = secretsOf<SpSecrets>(conn);
  if (!conn || !s) throw new AppError(409, "integration_not_connected", "Safepay is not connected.");
  const c = await confirmWithProvider(s.secretKey, p as Pay);
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "safepay", direction: "outbound", kind: "reporter.payment", status: c.ok ? "ok" : "error", reference: p.provider_session,
    summary: `State ${c.state ?? "unknown"} · response fields: ${c.shape || "n/a"}`, error: c.ok ? null : c.reason });
  if (!c.ok) {
    if (c.temporary) throw new AppError(503, "provider_error", c.reason);
    return { state: c.state ?? "unknown", changed: false, note: `Not recorded: ${c.reason}` };
  }
  const mapped = mapTrackerState(c.state);
  if (!mapped || mapped === "partially_refunded") return { state: c.state ?? "unknown", changed: false, note: mapped ? "Partial refund amount not available from status check; use the refund webhook." : "Unmapped Safepay state; status left unchanged." };
  const changed = await sql.begin(async (tx) => {
    const [row] = await tx`select * from payments where id = ${paymentId} for update`;
    return applyStatus(tx, row as never, mapped as Status, mapped === "refunded" ? { refunded: Number(row.amount_cents) } : {});
  });
  if (changed) await activity(sql, actor.workspaceId, actor.id, { contactId: p.contact_id, opportunityId: p.opportunity_id, type: "payment.synced", summary: `Safepay status checked by ${actor.name}: ${c.state}` });
  return { state: c.state, changed };
}
