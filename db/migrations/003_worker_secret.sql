-- 003_worker_secret: a random secret held only in the database. Supabase pg_cron reads it when
-- calling /api/worker/tick, so the scheduler needs no secret copied into hosting settings or Git.
alter table worker_state add column secret text not null default encode(gen_random_bytes(32), 'hex');
