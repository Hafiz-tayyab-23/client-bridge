import "server-only";
import { appOrigin } from "../origin";
import { z } from "zod";
import { sql } from "../db";
import { maskSecret } from "../crypto";
import { badRequest, notFound } from "../http";
import { audit } from "../audit";
import { requirePerm, type Actor } from "../permissions";
import { getConnection, recordEvent, secretsOf, upsertConnection, type Provider } from "../integrations/store";
import { stripe, STRIPE_EVENTS } from "../integrations/stripe";
import { getMe } from "../integrations/telegram";

/** What each integration can and cannot do, shown in the UI (I5.6). */
export const LIMITS: Record<Provider, string[]> = {
  stripe: [
    "Test mode only: use Stripe's published test cards (e.g. 4242 4242 4242 4242).",
    "Card details are entered only on Stripe's hosted Checkout page; this platform never sees them.",
    "Checkout links expire after 30 minutes by default; refunds are made in the Stripe Dashboard and reflected here by webhook.",
  ],
  telegram: [
    "Reaches only people who have started a chat with your bot.",
    "Telegram does not report delivery or read status; messages show as sent or failed.",
    "Webhook authenticity uses Telegram's secret-token header (Telegram does not sign request bodies).",
  ],
  google: ["Each employee connects their own Google account.", "An app in Google 'testing' status accepts only listed test users and may issue short-lived refresh tokens."],
  twilio: ["Not used: replaced by Telegram with organizer permission."],
};

export async function listIntegrations(actor: Actor) {
  requirePerm(actor, "integrations.manage");
  const rows = await sql`
    select id, provider, user_id, status, config, last_success_at, last_error, last_error_at, updated_at
    from integration_connections where workspace_id = ${actor.workspaceId} order by provider`;
  const recentErrors = await sql`
    select provider, kind, error, created_at from integration_events
    where workspace_id = ${actor.workspaceId} and status in ('error','rejected') order by created_at desc limit 20`;
  const base = await appOrigin();
  const providers: Provider[] = ["telegram", "stripe", "google"];
  return providers.map((p) => {
    const conns = rows.filter((r) => r.provider === p);
    const ws = conns.find((c) => !c.user_id);
    return {
      provider: p,
      status: p === "google" ? (conns.some((c) => c.status === "connected") ? "connected" : "not_connected") : ws?.status ?? "not_connected",
      connectionId: ws?.id ?? null,
      config: ws?.config ?? {},
      lastSuccessAt: ws?.last_success_at ?? null,
      lastError: ws?.last_error ?? null,
      webhookUrl: ws && p !== "google" ? `${base}/api/webhooks/${p}/${ws.id}` : null,
      employees: p === "google" ? conns.map((c) => ({ userId: c.user_id, status: c.status, lastError: c.last_error })) : undefined,
      recentErrors: recentErrors.filter((e) => e.provider === p).slice(0, 5),
      limits: LIMITS[p],
    };
  });
}

export async function listEvents(actor: Actor, q: { provider?: string; page: number }) {
  requirePerm(actor, "integrations.manage");
  return sql`
    select id, provider, direction, kind, status, reference, summary, error, created_at from integration_events
    where workspace_id = ${actor.workspaceId} ${q.provider ? sql`and provider = ${q.provider}` : sql``}
    order by id desc limit 50 offset ${(q.page - 1) * 50}`;
}

// ───────── Stripe ─────────
export const StripeConnectInput = z.object({
  secretKey: z.string().trim().regex(/^(sk|rk)_test_[A-Za-z0-9]{10,}$/, "Use a Stripe *test* secret key (starts with sk_test_)."),
  webhookSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9]{10,}$/, "Webhook signing secrets start with whsec_.").optional().or(z.literal("").transform(() => undefined)),
});

/** Verifies the key, stores it encrypted, and registers this workspace's webhook endpoint when the app is public. */
export async function connectStripe(actor: Actor, input: z.infer<typeof StripeConnectInput>) {
  requirePerm(actor, "integrations.manage");
  const check = await stripe<{ id: string; settings?: { dashboard?: { display_name?: string } } }>(input.secretKey, "GET", "/account");
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "stripe", direction: "outbound", kind: "account.verify", status: check.ok ? "ok" : "error", reference: check.requestId, error: check.error });
  if (!check.ok) throw badRequest(check.error ?? "Stripe rejected the key.");
  const existing = await getConnection(sql, actor.workspaceId, "stripe");
  const prevSecrets = secretsOf<{ secretKey: string; webhookSecret?: string; webhookEndpointId?: string }>(existing);
  let conn = await upsertConnection(sql, actor.workspaceId, "stripe", null, {
    status: "connected",
    config: { accountId: check.data?.id, accountName: check.data?.settings?.dashboard?.display_name ?? null },
    secrets: { secretKey: input.secretKey, webhookSecret: input.webhookSecret ?? prevSecrets?.webhookSecret, webhookEndpointId: prevSecrets?.webhookEndpointId },
  });
  let webhookNote = input.webhookSecret ? "Webhook secret saved." : "";
  const base = await appOrigin();
  if (!input.webhookSecret && !prevSecrets?.webhookSecret && base.startsWith("https://")) {
    const ep = await stripe<{ id: string; secret: string }>(input.secretKey, "POST", "/webhook_endpoints", {
      url: `${base}/api/webhooks/stripe/${conn.id}`,
      enabled_events: STRIPE_EVENTS,
      description: `LeadGuard workspace ${actor.workspaceId}`,
    }, `wh-${conn.id}`);
    await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "stripe", direction: "outbound", kind: "webhook_endpoint.create", status: ep.ok ? "ok" : "error", reference: ep.data?.id ?? ep.requestId, error: ep.error });
    if (ep.ok && ep.data) {
      conn = await upsertConnection(sql, actor.workspaceId, "stripe", null, {
        status: "connected", config: conn.config, secrets: { secretKey: input.secretKey, webhookSecret: ep.data.secret, webhookEndpointId: ep.data.id },
      });
      webhookNote = "Webhook endpoint registered with Stripe automatically.";
    } else webhookNote = `Could not register webhook automatically (${ep.error}). Add the endpoint in Stripe and paste its signing secret.`;
  } else if (!input.webhookSecret && !prevSecrets?.webhookSecret) {
    webhookNote = "App URL is not public HTTPS, so add the webhook in Stripe manually and paste its signing secret.";
  }
  await audit(sql, actor.workspaceId, actor, {
    event: existing ? "integration.changed" : "integration.connected", targetType: "integration", targetId: conn.id,
    before: existing ? { status: existing.status, key: maskSecret(prevSecrets?.secretKey) } : undefined,
    after: { provider: "stripe", status: "connected", key: maskSecret(input.secretKey), account: check.data?.id },
  });
  return { connectionId: conn.id, status: "connected", key: maskSecret(input.secretKey), webhookNote };
}

export async function disconnect(actor: Actor, provider: "stripe" | "telegram") {
  requirePerm(actor, "integrations.manage");
  const c = await getConnection(sql, actor.workspaceId, provider);
  if (!c) throw notFound("Not connected.");
  const s = secretsOf<Record<string, string>>(c);
  if (provider === "stripe" && s?.webhookEndpointId && s.secretKey) {
    const r = await stripe(s.secretKey, "DELETE", `/webhook_endpoints/${s.webhookEndpointId}`);
    await recordEvent(sql, { workspaceId: actor.workspaceId, provider, direction: "outbound", kind: "webhook_endpoint.delete", status: r.ok ? "ok" : "error", error: r.error });
  }
  if (provider === "telegram" && s?.botToken) {
    await fetch(`https://api.telegram.org/bot${s.botToken}/deleteWebhook`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
  await upsertConnection(sql, actor.workspaceId, provider, null, { status: "not_connected", config: {}, secrets: null });
  await audit(sql, actor.workspaceId, actor, { event: "integration.disconnected", targetType: "integration", targetId: c.id, before: { provider, status: c.status } });
}

// ───────── Telegram (bot token; webhook wiring arrives with I1) ─────────
export const TelegramConnectInput = z.object({ botToken: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,}$/, "That does not look like a bot token from @BotFather.") });

export async function connectTelegram(actor: Actor, input: z.infer<typeof TelegramConnectInput>, webhookSecret: string, afterSave?: (connectionId: string) => Promise<string>) {
  requirePerm(actor, "integrations.manage");
  const me = await getMe(input.botToken);
  await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "telegram", direction: "outbound", kind: "getMe", status: me.ok ? "ok" : "error", error: me.error });
  if (!me.ok) throw badRequest(`Telegram rejected the token: ${me.error}`);
  const existing = await getConnection(sql, actor.workspaceId, "telegram");
  const conn = await upsertConnection(sql, actor.workspaceId, "telegram", null, {
    status: "connected", config: { botUsername: me.username }, secrets: { botToken: input.botToken, webhookSecret },
  });
  const note = afterSave ? await afterSave(conn.id) : "";
  await audit(sql, actor.workspaceId, actor, {
    event: existing ? "integration.changed" : "integration.connected", targetType: "integration", targetId: conn.id,
    after: { provider: "telegram", bot: me.username, token: maskSecret(input.botToken) },
  });
  return { connectionId: conn.id, botUsername: me.username, note };
}
