import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "../crypto";

// Safepay (Pakistan) sandbox adapter. Endpoints and headers follow Safepay's official docs and the
// official @sfpy/node-core 0.3.5 SDK: /order/payments/v3/, /client/passport/v1/token,
// /reporter/api/v1/payments/{tracker}, header x-sfpy-merchant-secret, hosted checkout at /embedded/.
export const SAFEPAY_API = "https://sandbox.api.getsafepay.com";
const CHECKOUT = "https://sandbox.api.getsafepay.com/embedded/";

export interface SpResult<T> { ok: boolean; status: number; data?: T; error?: string; permanent?: boolean }

export async function safepay<T>(secretKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<SpResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${SAFEPAY_API}${path}`, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-sfpy-merchant-secret": secretKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: T; status?: { message?: string; errors?: string[] } };
      if (res.ok) return { ok: true, status: res.status, data: json.data as T };
      const temporary = res.status === 429 || res.status >= 500;
      if (temporary && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      const msg = json.status?.errors?.join("; ") || json.status?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, permanent: !temporary, error: res.status === 401 || res.status === 403 ? `Safepay rejected the credentials (${msg}). Re-enter the sandbox keys on the Integrations page.` : `Safepay: ${msg}` };
    } catch (e) {
      if (attempt === 0) continue;
      return { ok: false, status: 0, error: `Safepay unreachable (${(e as Error).message}). Try again shortly.` };
    }
  }
  return { ok: false, status: 0, error: "Safepay request failed." };
}

export async function passportToken(secretKey: string) {
  return safepay<string>(secretKey, "POST", "/client/passport/v1/token", {});
}

/** Creates a payment session. Amount in the currency's lowest denomination (docs: $100 = 10000). */
export async function createSession(apiKey: string, secretKey: string, amountMinor: number, currency: string, metadata: Record<string, string>) {
  return safepay<{ tracker: { token: string } }>(secretKey, "POST", "/order/payments/v3/", {
    merchant_api_key: apiKey, intent: "CYBERSOURCE", mode: "payment", currency: currency.toUpperCase(), amount: amountMinor, metadata,
  });
}

export function checkoutUrl(p: { tracker: string; tbt: string; redirectUrl: string; cancelUrl: string; orderId: string }) {
  const q = new URLSearchParams({ environment: "sandbox", tracker: p.tracker, tbt: p.tbt, source: "hosted", redirect_url: p.redirectUrl, cancel_url: p.cancelUrl, order_id: p.orderId });
  return `${CHECKOUT}?${q}`;
}

export async function fetchTracker(secretKey: string, tracker: string) {
  return safepay<Record<string, unknown>>(secretKey, "GET", `/reporter/api/v1/payments/${encodeURIComponent(tracker)}`);
}

/** Maps documented tracker states to our payment statuses; unknown states are reported, not guessed. */
export function mapTrackerState(state: string | undefined): "paid" | "cancelled" | "expired" | "refunded" | "partially_refunded" | "pending" | null {
  switch (state) {
    case "TRACKER_ENDED": return "paid";
    case "TRACKER_CANCELLED": return "cancelled";
    case "TRACKER_EXPIRED": return "expired";
    case "TRACKER_REFUNDED": return "refunded";
    case "TRACKER_PARTIAL_REFUND": return "partially_refunded";
    case "TRACKER_STARTED": return "pending";
    default: return null;
  }
}

/**
 * X-SFPY-SIGNATURE = hex HMAC-SHA512 keyed with the Webhook Secret Key. Safepay's docs sign the JSON
 * payload while the older official SDK signs JSON.stringify(body.data); both documented variants are
 * accepted and the matching variant is reported.
 */
export function verifySafepayWebhook(rawBody: string, signature: string | null, secret: string): { ok: boolean; variant?: string; reason?: string } {
  if (!signature) return { ok: false, reason: "Missing X-SFPY-SIGNATURE header" };
  let parsed: { data?: unknown } | null = null;
  try { parsed = JSON.parse(rawBody); } catch { return { ok: false, reason: "Malformed JSON body" }; }
  const candidates: [string, string][] = [["raw body", rawBody], ["JSON payload", JSON.stringify(parsed)]];
  if (parsed && typeof parsed === "object" && "data" in parsed) candidates.push(["data object", JSON.stringify(parsed.data)]);
  for (const [variant, payload] of candidates) {
    const expected = createHmac("sha512", secret).update(payload, "utf8").digest("hex");
    if (safeEqual(signature.trim().toLowerCase(), expected)) return { ok: true, variant };
  }
  return { ok: false, reason: "Signature does not match payload" };
}
