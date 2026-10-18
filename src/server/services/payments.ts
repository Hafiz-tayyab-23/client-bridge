import "server-only";
import { appOrigin } from "../origin";
import { z } from "zod";
import { sql, type Tx } from "../db";
import { badRequest, notFound, AppError } from "../http";
import { activity, audit } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { firstReceipt, getConnection, getConnectionById, markHealth, recordEvent, secretsOf } from "../integrations/store";
import { stripe, verifyStripeSignature } from "../integrations/stripe";
import { notifyUser } from "./notifications";
import { recordLeadAction } from "./leads";

export const CURRENCIES = ["usd", "eur", "gbp", "pkr", "aed"] as const;
export const PaymentRequestInput = z.object({
  amount: z.number().positive().max(999999),
  currency: z.enum(CURRENCIES),
  description: z.string().trim().max(200).optional(),
  provider: z.enum(["stripe", "safepay"]).default("stripe"),
});

type StripeSecrets = { secretKey: string; webhookSecret?: string };

/** I2.1: payment link (Checkout Session) for a stated amount, created from an opportunity. */
export async function createPaymentRequest(actor: Actor, opportunityId: string, input: z.infer<typeof PaymentRequestInput>) {
  requirePerm(actor, "crm.edit");
  const mine = can(actor, "crm.view_all") ? null : actor.id;
  const [opp] = await sql`
    select o.*, c.name as contact_name, c.email as contact_email from opportunities o left join contacts c on c.id = o.contact_id
    where o.id = ${opportunityId} and o.workspace_id = ${actor.workspaceId} ${mine ? sql`and o.owner_id = ${mine}` : sql``}`;
  if (!opp) throw notFound("Opportunity not found.");
  if (input.provider === "safepay") return (await import("./safepay-payments")).createSafepayRequest(actor, opp as never, input);
  const conn = await getConnection(sql, actor.workspaceId, "stripe");
  const secrets = secretsOf<StripeSecrets>(conn);
  if (!conn || conn.status === "not_connected" || !secrets?.secretKey) {
    throw new AppError(409, "integration_not_connected", "Stripe is not connected for this workspace. An admin can connect it on the Integrations page.");
  }
  const amountCents = Math.round(input.amount * 100);
  const [payment] = await sql`
    insert into payments (workspace_id, opportunity_id, contact_id, requested_by, amount_cents, currency, status)
    values (${actor.workspaceId}, ${opp.id}, ${opp.contact_id}, ${actor.id}, ${amountCents}, ${input.currency}, 'pending') returning *`;
  const base = await appOrigin();
  const r = await stripe<{ id: string; url: string; payment_intent: string | null; expires_at: number }>(secrets.secretKey, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: amountCents, product_data: { name: input.description || opp.title } } }],
    success_url: `${base}/pay/done?ref=${payment.id}`,
    cancel_url: `${base}/pay/done?ref=${payment.id}&cancelled=1`,
    client_reference_id: payment.id,
    customer_email: opp.contact_email ?? undefined,
    metadata: { payment_id: payment.id, workspace_id: actor.workspaceId, opportunity_id: opp.id },
    payment_intent_data: { metadata: { payment_id: payment.id, workspace_id: actor.workspaceId } },
  }, `pay-${payment.id}`);
  await recordEvent(sql, {
    workspaceId: actor.workspaceId, provider: "stripe", direction: "outbound", kind: "checkout.session.create",
    status: r.ok ? "ok" : "error", reference: r.data?.id ?? r.requestId, summary: `${amountCents / 100} ${input.currency.toUpperCase()} for ${opp.title}`, error: r.error,
  });
  if (!r.ok || !r.data) {
    await sql`update payments set status = 'failed', updated_at = now() where id = ${payment.id}`;
    await markHealth(sql, conn.id, false, r.error);
    throw new AppError(r.permanent ? 400 : 503, "provider_error", r.error ?? "Stripe request failed.");
  }
  await markHealth(sql, conn.id, true);
  return sql.begin(async (tx) => {
    const [p] = await tx`update payments set provider_session = ${r.data!.id}, provider_intent = ${r.data!.payment_intent}, url = ${r.data!.url}, updated_at = now()
      where id = ${payment.id} returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: opp.contact_id, opportunityId: opp.id, type: "payment.requested", summary: `Payment link for ${(amountCents / 100).toFixed(2)} ${input.currency.toUpperCase()} created by ${actor.name}` });
    await audit(tx, actor.workspaceId, actor, { event: "payment.requested", targetType: "payment", targetId: p.id, after: { amount_cents: amountCents, currency: input.currency, provider_session: r.data!.id } });
    if (opp.contact_id) await recordLeadAction(tx, actor, opp.contact_id, "payment request");
    return p;
  });
}

// ───────── Webhook (I2.2–I2.5) ─────────
export type Status = "pending" | "paid" | "failed" | "expired" | "cancelled" | "refunded" | "partially_refunded";

export async function applyStatus(tx: Tx, p: Record<string, unknown> & { id: string; workspace_id: string }, status: Status, fields: { intent?: string | null; refunded?: number; reason?: string }) {
  // A paid payment is never downgraded by late failure/expiry events.
  if (["paid", "refunded", "partially_refunded"].includes(p.status as string) && (status === "failed" || status === "expired" || status === "cancelled" || status === "pending")) return false;
  const [after] = await tx`
    update payments set status = ${status},
      provider_intent = coalesce(${fields.intent ?? null}, provider_intent),
      refunded_cents = coalesce(${fields.refunded ?? null}, refunded_cents),
      paid_at = case when ${status} = 'paid' and paid_at is null then now() else paid_at end,
      updated_at = now()
    where id = ${p.id} returning *`;
  if (p.status === status && fields.refunded === undefined) return false;
  const amount = `${(Number(after.amount_cents) / 100).toFixed(2)} ${String(after.currency).toUpperCase()}`;
  const summary = status === "paid" ? `Payment received: ${amount}`
    : status === "refunded" ? `Payment refunded in full: ${amount}`
    : status === "partially_refunded" ? `Partial refund: ${(Number(after.refunded_cents) / 100).toFixed(2)} of ${amount}`
    : status === "expired" ? `Payment link expired (${amount})`
    : status === "cancelled" ? `Payment cancelled by the customer (${amount})`
    : status === "pending" ? `Payment pending (${amount})`
    : `Payment failed (${amount})${fields.reason ? `: ${fields.reason}` : ""}`;
  await activity(tx, p.workspace_id, null, { contactId: after.contact_id, opportunityId: after.opportunity_id, type: `payment.${status}`, summary });
  await audit(tx, p.workspace_id, null, { event: `payment.${status}`, targetType: "payment", targetId: p.id, before: { status: p.status, refunded_cents: p.refunded_cents }, after: { status, refunded_cents: after.refunded_cents } });
  if (after.requested_by) {
    await notifyUser(tx, { workspaceId: p.workspace_id, userId: after.requested_by, kind: `payment.${status}`, title: summary, body: "Updated by Stripe webhook.", link: after.opportunity_id ? `/opportunities/${after.opportunity_id}` : undefined });
  }
  return true;
}

interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: Record<string, unknown> & { id: string; metadata?: Record<string, string> } } }

/** Verified before any record changes; duplicate events are processed once (I2.3, I2.4). */
export async function handleStripeWebhook(connectionId: string, rawBody: string, signature: string | null) {
  const conn = await getConnectionById(connectionId);
  if (!conn || conn.provider !== "stripe") throw notFound();
  const secret = secretsOf<StripeSecrets>(conn)?.webhookSecret;
  if (!secret) {
    await recordEvent(sql, { workspaceId: conn.workspace_id, provider: "stripe", direction: "inbound", kind: "webhook", status: "rejected", error: "No webhook signing secret configured" });
    throw badRequest("Webhook secret not configured.");
  }
  const v = verifyStripeSignature(rawBody, signature, secret);
  if (!v.ok) {
    await recordEvent(sql, { workspaceId: conn.workspace_id, provider: "stripe", direction: "inbound", kind: "webhook", status: "rejected", error: v.reason });
    throw new AppError(400, "invalid_signature", v.reason ?? "Invalid signature");
  }
  const event = JSON.parse(rawBody) as StripeEvent;
  if (event.livemode) {
    await recordEvent(sql, { workspaceId: conn.workspace_id, provider: "stripe", direction: "inbound", kind: event.type, status: "rejected", reference: event.id, error: "Live-mode event ignored (test mode only)" });
    return { ignored: "livemode" };
  }
  return sql.begin(async (tx) => {
    if (!(await firstReceipt(tx, "stripe", `${conn.workspace_id}:${event.id}`))) {
      await recordEvent(tx, { workspaceId: conn.workspace_id, provider: "stripe", direction: "inbound", kind: event.type, status: "duplicate", reference: event.id, summary: "Already processed; ignored" });
      return { duplicate: true };
    }
    const obj = event.data.object;
    const paymentId = obj.metadata?.payment_id ?? (obj.client_reference_id as string | undefined);
    const intentId = (obj.payment_intent as string | undefined) ?? (event.type.startsWith("payment_intent.") ? obj.id : undefined);
    const [p] = paymentId
      ? await tx`select * from payments where id = ${paymentId} and workspace_id = ${conn.workspace_id} for update`
      : intentId ? await tx`select * from payments where provider_intent = ${intentId} and workspace_id = ${conn.workspace_id} for update` : [];
    let changed = false;
    if (p) {
      const pay = p as Record<string, unknown> & { id: string; workspace_id: string };
      switch (event.type) {
        case "checkout.session.completed":
          changed = await applyStatus(tx, pay, obj.payment_status === "paid" ? "paid" : "pending", { intent: intentId });
          break;
        case "checkout.session.async_payment_succeeded":
          changed = await applyStatus(tx, pay, "paid", { intent: intentId });
          break;
        case "checkout.session.async_payment_failed":
          changed = await applyStatus(tx, pay, "failed", { intent: intentId });
          break;
        case "checkout.session.expired":
          changed = await applyStatus(tx, pay, "expired", {});
          break;
        case "payment_intent.payment_failed": {
          const err = (obj.last_payment_error as { message?: string } | undefined)?.message;
          changed = await applyStatus(tx, pay, "failed", { intent: obj.id, reason: err });
          break;
        }
        case "charge.refunded": {
          const refunded = Number(obj.amount_refunded ?? 0);
          changed = await applyStatus(tx, pay, refunded >= Number(pay.amount_cents) ? "refunded" : "partially_refunded", { refunded });
          break;
        }
      }
    }
    await recordEvent(tx, {
      workspaceId: conn.workspace_id, provider: "stripe", direction: "inbound", kind: event.type, status: "ok", reference: event.id,
      summary: p ? (changed ? `Payment ${p.id.slice(0, 8)} updated` : `Payment ${p.id.slice(0, 8)} unchanged`) : "No matching payment in this workspace",
    });
    await markHealth(tx, conn.id, true);
    return { received: true, matched: Boolean(p), changed };
  });
}

// ───────── Queries ─────────
export async function listPayments(actor: Actor, q: { status?: string; page: number; pageSize: number }) {
  requirePerm(actor, "crm.view");
  const mine = can(actor, "crm.view_all") ? null : actor.id;
  const where = sql`p.workspace_id = ${actor.workspaceId} ${mine ? sql`and p.requested_by = ${mine}` : sql``} ${q.status ? sql`and p.status = ${q.status}` : sql``}`;
  const [{ total }] = await sql`select count(*)::int as total from payments p where ${where}`;
  const rows = await sql`
    select p.id, p.provider, p.status, p.amount_cents, p.currency, p.refunded_cents, p.url, p.provider_session, p.provider_intent, p.created_at, p.paid_at,
           p.opportunity_id, o.title as opportunity_title, p.contact_id, c.name as contact_name, p.requested_by, u.name as requested_by_name
    from payments p left join opportunities o on o.id = p.opportunity_id left join contacts c on c.id = p.contact_id left join users u on u.id = p.requested_by
    where ${where} order by p.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`;
  const show = can(actor, "crm.view_value");
  return { total, payments: show ? rows : rows.map((r) => ({ ...r, amount_cents: null, refunded_cents: null, value_masked: true })) };
}

/** Collected revenue = confirmed payments − confirmed refunds (glossary; I2.6). One definition for every screen (Q12). */
export function collectedRevenueSql(workspaceId: string, from: Date, userId?: string | null) {
  return sql`
    select currency, coalesce(sum(amount_cents - refunded_cents), 0)::bigint as collected_cents, count(*)::int as payments
    from payments where workspace_id = ${workspaceId} and status in ('paid','partially_refunded','refunded') and paid_at >= ${from}
      ${userId ? sql`and requested_by = ${userId}` : sql``}
    group by currency order by currency`;
}
