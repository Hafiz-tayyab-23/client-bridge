-- 002_worker: single-row lease so overlapping ticks (pg_cron, browser polls) never run concurrently.
create table worker_state (
  id            int primary key default 1 check (id = 1),
  last_tick_at  timestamptz not null default 'epoch',
  last_result   jsonb
);
insert into worker_state (id) values (1);
