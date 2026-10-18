-- Run once in the Supabase SQL editor AFTER the app is deployed and migration 003 is applied.
-- Calls the app's worker every 5 seconds so escalation timers fire even with no user online.
-- The bearer secret is read from worker_state at call time; nothing secret lives in this file.
-- Replace only the app URL.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lead-worker-tick') where exists (select 1 from cron.job where jobname = 'lead-worker-tick');

select cron.schedule(
  'lead-worker-tick',
  '5 seconds',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/worker/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select secret from public.worker_state where id = 1), 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Verify:    select jobname, schedule, active from cron.job;
-- Responses: select status_code, content from net._http_response order by created desc limit 5;
