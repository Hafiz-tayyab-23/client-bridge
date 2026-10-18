-- Run once in the Supabase SQL editor AFTER the app is deployed (free plan, no card needed).
-- Calls the app's worker every 5 seconds so escalation timers fire even with no user online.
-- Replace the two placeholders; do not commit the real secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lead-worker-tick') where exists (select 1 from cron.job where jobname = 'lead-worker-tick');

select cron.schedule(
  'lead-worker-tick',
  '5 seconds',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/worker/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_WORKER_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Verify:   select jobname, schedule, active from cron.job;
-- History:  select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- Responses: select status_code, content from net._http_response order by created desc limit 5;
