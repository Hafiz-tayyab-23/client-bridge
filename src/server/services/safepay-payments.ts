import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { maskSecret } from "../crypto";
import { AppError, badRequest, notFound } from "../http";
import { activity, audit } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { firstReceipt, getConnection, getConnectionById, markHealth, recordEvent, secretsOf, upsertConnection } from "../integrations/store";
import { checkoutUrl, createSession, passportToken } from "../integrations/safepay";
import { appOrigin } from "../origin";
import { recordLeadAction } from "./leads";
import { applyStatus, type PaymentRequestInput, type Status } from "./payments";

type SpSecrets = { apiKey: string; secretKey: string; webhookSecret?: string };

export const SafepayConnectInput = z.object({
  apiKey: z.string().trim().regex(/^sec_[A-Za-z0-9-]{8,}$/, "The Public API Key starts with sec_."),
  secretKey: z.string().trim().min(16, "Paste the Private API Secret Key.").max(300),
  webhookSecret: z.string().trim().min(16).max(300).optional().or(z.literal("").transform(() => undefined)),
});

/** Verifies sandbox keys by requesting a passport token, then stores them encrypted per workspace (I5.2, I5.3). */
export async function connectSafepay(actor: Actor, input: z.infer<typeof SafepayConnectInput>) {
  requirePerm(actor, "integrations.manage");
  const check = await passportToken(input.secretKey);
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "safepay", direction: "outbound", kind: "passport.token", status: check.ok ? "ok" : "error", error: check.error });
  if (!check.ok) throw badRequest(check.error ?? "Safepay rejected the keys.");
  const existing = await getConnection(sql, actor.workspaceId, "safepay");
  const prev = secretsOf<SpSecrets>(existing);
  const conn = await upsertConnection(sql, actor.workspaceId, "safepay", null, {
    status: "connected", config: { environment: "sandbox", apiKey: maskSecret(input.apiKey) },
    secrets: { apiKey: input.apiKey, secretKey: input.secretKey, webhookSecret: input.webhookSecret ?? prev?.webhookSecret },
  });
  await audit(sql, actor.workspaceId, actor, {
    event: existing ? "integration.changed" : "integration.connected", targetType: "integration", targetId: conn.id,
    after: { provider: "safepay", environment: "sandbox", apiKey: maskSecret(input.apiKey), webhookSecret: input.webhookSecret ? "set" : prev?.webhookSecret ? "unchanged" : "missing" },
  });
  return { connectionId: conn.id, webhookUrl: `${await appOrigin()}/api/webhooks/safepay/${conn.id}`, note: input.webhookSecret || prev?.webhookSecret ? "" : "Add the webhook endpoint in Safepay (Developers → Endpoints) and save its shared secret here." };
}

export async function disconnectSafepay(actor: Actor) {
  requirePerm(actor, "integrations.manage");
  const c = await getConnection(sql, actor.workspaceId, "safepay");
  if (!c) throw notFound("Not connected.");
  await upsertConnection(sql, actor.workspaceId, "safepay", null, { status: "not_connected", config: {}, secrets: null });
  await audit(sql, actor.workspaceId, actor, { event: "integration.disconnected", targetType: "integration", targetId: c.id, before: { provider: "safepay" } });
}

/** Creates a real Safepay sandbox payment session + hosted checkout link for an opportunity. */
export async function createSafepayRequest(actor: Actor, opp: Record<string, unknown> & { id: string; title: string; contact_id: string | null }, input: z.infer<typeof PaymentRequestInput>) {
  const conn = await getConnection(sql, actor.workspaceId, "safepay");
  const s = secretsOf<SpSecrets>(conn);
  if (!conn || conn.status === "not_connected" || !s) throw new AppError(409, "integration_not_connected", "Safepay is not connected for this workspace. An admin can connect it on the Integrations page.");
  const amountMinor = Math.round(input.amount * 100);
  const [payment] = await sql`insert into payments (workspace_id, opportunity_id, contact_id, requested_by, amount_cents, currency, status, provider)
    values (${actor.workspaceId}, ${opp.id}, ${opp.contact_id}, ${actor.id}, ${amountMinor}, ${input.currency}, 'pending', 'safepay') returning *`;
  const session = await createSession(s.apiKey, s.secretKey, amountMinor, input.currency, { payment_id: payment.id, workspace_id: actor.workspaceId });
  const tracker = session.data?.tracker?.token;
  const tbt = session.ok && tracker ? await passportToken(s.secretKey) : null;
  const ok = Boolean(session.ok && tracker && tbt?.ok && tbt.data);
  const err = !session.ok ? session.error : !tracker ? "Safepay did not return a tracker." : tbt?.error ?? "Safepay did not return a checkout token.";
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "safepay", direction: "outbound", kind: "payments.v3.create", status: ok ? "ok" : "error", reference: tracker ?? null, summary: `${input.amount} ${input.currency.toUpperCase()} for ${opp.title}`, error: ok ? null : err });
  if (!ok) {
    await sql`update payments set status = 'failed', updated_at = now() where id = ${payment.id}`;
    await markHealth(sql, conn.id, false, err);
    throw new AppError(session.permanent ? 400 : 503, "provider_error", err ?? "Safepay request failed.");
  }
  await markHealth(sql, conn.id, true);
  const origin = await appOrigin();
  const url = checkoutUrl({ tracker: tracker!, tbt: tbt!.data!, orderId: payment.id, redirectUrl: `${origin}/pay/done?ref=${payment.id}`, cancelUrl: `${origin}/pay/done?ref=${payment.id}&cancelled=1` });
  return sql.begin(async (tx) => {
    const [p] = await tx`update payments set provider_session = ${tracker ?? null}, url = ${url}, updated_at = now() where id = ${payment.id} returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: opp.contact_id, opportunityId: opp.id, type: "payment.requested", summary: `Safepay link for ${input.amount.toFixed(2)} ${input.currency.toUpperCase()} created by ${actor.name}` });
    await audit(tx, actor.workspaceId, actor, { event: "payment.requested", targetType: "payment", targetId: p.id, after: { provider: "safepay", amount_cents: amountMinor, currency: input.currency, tracker } });
    if (opp.contact_id) await recordLeadAction(tx, actor, opp.contact_id, "payment request");
    return p;
  });
}

