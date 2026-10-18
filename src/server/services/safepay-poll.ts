import "server-only";
import { sql } from "../db";
import { getConnection, recordEvent, secretsOf } from "../integrations/store";
import { mapTrackerState } from "../integrations/safepay";
import { activity } from "../audit";
import { applyStatus, type Status } from "./payments";
import { confirmWithProvider } from "./safepay-events";

// Automatic, bounded confirmation of pending Safepay payments via the authenticated reporter API.
// Not a webhook: the confirmation source is labelled as a provider status check.
const MAX_ATTEMPTS = 12;          // ~15 s, 30 s, 60 s, 2 min, then every 5 min
const MAX_AGE_HOURS = 3;          // stop checking old links
const PER_TICK = 3;               // bounded work per worker pass

export async function pollSafepayPayments() {
  // Claim due payments atomically so overlapping ticks never check the same payment at once.
  const due = await sql<{ id: string; workspace_id: string; provider_check_attempts: number }[]>`
    update payments p set provider_check_attempts = p.provider_check_attempts + 1,
      next_provider_check_at = case when p.provider_check_attempts + 1 >= ${MAX_ATTEMPTS} then null
                                    else now() + make_interval(secs => least(300, 15 * power(2, p.provider_check_attempts + 1))) end
    where p.id in (
      select id from payments where provider = 'safepay' and status = 'pending' and provider_session is not null
        and next_provider_check_at is not null and next_provider_check_at <= now()
        and created_at > now() - make_interval(hours => ${MAX_AGE_HOURS})
      order by next_provider_check_at limit ${PER_TICK} for update skip locked)
    returning p.id, p.workspace_id, p.provider_check_attempts`;
  let confirmed = 0;
  for (const d of due) {
    const conn = await getConnection(sql, d.workspace_id, "safepay");
    const s = secretsOf<{ secretKey: string }>(conn);
    if (!s) continue;
    const [pay] = await sql`select * from payments where id = ${d.id}`;
    const c = await confirmWithProvider(s.secretKey, pay as never);
    const mapped = c.ok ? mapTrackerState(c.state) : null;
    const final = mapped === "paid" || mapped === "cancelled" || mapped === "expired";
    let changed = false;
    if (final) {
      changed = await sql.begin(async (tx) => {
        const [row] = await tx`select * from payments where id = ${d.id} for update`;
        const ch = await applyStatus(tx, row as never, mapped as Status, {}); // no-op if already recorded (no double counting)
        if (ch) await tx`update payments set confirmation_source = ${"Authenticated Safepay status check (automatic)"}, next_provider_check_at = null where id = ${d.id}`;
        return ch;
      });
      if (changed) { confirmed++; await activity(sql, d.workspace_id, null, { contactId: pay.contact_id, opportunityId: pay.opportunity_id, type: "payment.confirmed", summary: `Safepay reports ${c.state}; confirmed automatically by authenticated status check` }); }
    }
    await recordEvent(sql, {
      workspaceId: d.workspace_id, provider: "safepay", direction: "outbound", kind: "reporter.auto_check",
      status: c.ok ? "ok" : c.temporary ? "retrying" : "error", reference: pay.provider_session,
      summary: `Attempt ${d.provider_check_attempts}/${MAX_ATTEMPTS} · state ${c.state ?? "unknown"}${changed ? " · payment recorded" : final ? " · already recorded" : " · still pending"}`,
      error: c.ok ? null : c.reason,
    });
  }
  return { checked: due.length, confirmed };
}
