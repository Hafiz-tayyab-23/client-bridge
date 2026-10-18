import "server-only";
import { sql } from "./db";
import { escalateDue } from "./services/leads";
import { processOutbox } from "./services/notifications";
import { pollSafepayPayments } from "./services/safepay-poll";

/**
 * One worker pass: escalate expired leads, then deliver queued external alerts.
 * State lives in Postgres (deadlines, outbox), so a restart loses nothing (Q5).
 * Triggered every few seconds by Supabase pg_cron (via pg_net) and opportunistically by the
 * app's realtime poll; the lease below keeps passes from overlapping.
 */
export async function runTick(minIntervalSeconds = 2) {
  const lease = await sql`
    update worker_state set last_tick_at = now()
    where id = 1 and last_tick_at < now() - make_interval(secs => ${minIntervalSeconds})
    returning 1`;
  if (lease.length === 0) return { skipped: true };
  const escalation = await escalateDue();
  const outbox = await processOutbox();
  const payments = await pollSafepayPayments().catch((e) => ({ error: (e as Error).message }));
  const result = { at: new Date().toISOString(), escalation, outbox, payments };
  await sql`update worker_state set last_result = ${sql.json(result as never)} where id = 1`;
  return result;
}
