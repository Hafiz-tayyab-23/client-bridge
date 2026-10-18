import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "../crypto";

/** Stripe REST adapter (I2). Test mode only; no card data ever passes through this app (I2.8). */
export interface StripeResult<T> { ok: boolean; data?: T; status: number; error?: string; permanent?: boolean; requestId?: string }

function encode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === "object" ? encode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === "object") out.push(...encode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls Stripe; retries 429/5xx/network twice with backoff (I5.5). 4xx are permanent with Stripe's message. */
export async function stripe<T = Record<string, unknown>>(
  secretKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  const body = encode(params).join("&");
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
  let last: StripeResult<T> = { ok: false, status: 0, error: "not attempted" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400 * 3 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(10000),
      });
      const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
      const requestId = res.headers.get("request-id") ?? undefined;
      if (res.ok) return { ok: true, data: json, status: res.status, requestId };
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      const temporary = res.status === 429 || res.status >= 500;
      last = { ok: false, status: res.status, error: explain(res.status, msg), permanent: !temporary, requestId };
      if (!temporary) return last;
    } catch (e) {
      last = { ok: false, status: 0, error: `Stripe unreachable (${(e as Error).message}). Try again shortly.`, permanent: false };
    }
  }
  return last;
}

function explain(status: number, msg: string) {
  if (status === 401) return "Stripe rejected the API key. Re-enter a valid test secret key on the Integrations page.";
  if (status === 429) return "Stripe rate limit reached; retried and still busy. Try again in a minute.";
  if (status >= 500) return "Stripe is temporarily unavailable. Try again shortly.";
  return `Stripe: ${msg}`;
}

/** Verifies `Stripe-Signature` (t=..., v1=...) over the raw body with a 5-minute tolerance (I2.3). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300): { ok: boolean; reason?: string } {
  if (!header) return { ok: false, reason: "Missing Stripe-Signature header" };
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0) return { ok: false, reason: "Malformed Stripe-Signature header" };
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return { ok: false, reason: "Signature timestamp outside tolerance (possible replay)" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return sigs.some((s) => safeEqual(s, expected)) ? { ok: true } : { ok: false, reason: "Signature does not match payload" };
}

export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
];
