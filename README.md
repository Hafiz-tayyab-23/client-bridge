# LeadGuard — NASCON Web Dev, Team 034

A multi-company sales platform where every incoming lead has exactly one accountable owner. A lead escalates automatically when its owner ignores it, and every action is traceable.

> Status: backend and infrastructure in progress. The current screens are **temporary test UI**; the approved design will replace them.

## Architecture
| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 16 (App Router, TypeScript) | JSON route handlers under `src/app/api/**`; UI calls only these endpoints |
| Business rules | `src/server/services/*` | accounts, team/roles, leads (assignment, escalation, recovery), notifications |
| Data access | `src/server/db.ts` + SQL migrations in `db/migrations` | Postgres via `postgres` driver; every query scoped by `workspace_id` |
| Integrations | `src/server/integrations/*` | per-workspace encrypted credentials, sync history, retries |
| Presentation | `src/app/**/page.tsx`, `src/components/temp/*` | temporary; replace without touching services |
| Database | Supabase Postgres (free plan) | |
| Hosting | Vercel Hobby (free) | |
| Timers | Postgres-stored deadlines + `/api/worker/tick` | triggered every 5 s by Supabase `pg_cron` + `pg_net`; also nudged by the app's realtime poll |

Security: bcrypt password hashes, server-side revocable sessions (httpOnly, SameSite=Lax, 7-day expiry, 24-hour idle timeout), login throttling, Origin-checked mutations (CSRF), Zod validation, parameterised SQL, workspace-scoped queries, and an append-only audit log enforced by a database trigger.

Concurrency: a per-workspace advisory lock serialises assignment decisions. Each expired lead is re-checked under a row lock, so it is never escalated twice. A partial unique index ensures a lead never has two open assignments.

## Local setup
```bash
npm install
cp .env.example .env         # fill DATABASE_URL etc. (scripts read .env)
cp .env.example .env.local   # same values (Next.js reads .env.local)
npm run db:dev               # optional: local Postgres without Docker (port 54329), keep running
npm run db:migrate
npm run dev                  # http://localhost:3000
npm run smoke                # end-to-end API checks against BASE (default localhost:3000)
```
For a local DB, use `DATABASE_URL=postgres://postgres:devpass@localhost:54329/nascon`. Generate `APP_ENCRYPTION_KEY` with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Deployment (free tiers, no card)
1. Supabase: create a project, then copy the **transaction pooler** connection string (port 6543) and the **session/direct** string (port 5432).
2. Run migrations from a laptop: `DATABASE_URL_DIRECT=<direct url> npm run db:migrate`.
3. Vercel: import this GitHub repo and set the env vars from `.env.example` (`DATABASE_URL` = pooler URL, `APP_URL` = the Vercel URL).
4. Supabase SQL editor: run `db/supabase/worker-cron.sql` with your app URL and `WORKER_SECRET`.

## Trying it
1. Open `/signup` to create a company workspace. You become its Owner.
2. Go to Team and invite a user, then open the invite link in a private window to join.
3. Go to Assignment rules and set short windows (e.g. 10 s) for a demo.
4. Submit the public form at `/f/<workspace-id>` (linked from Home). The lead gets one owner and a countdown starts. If nobody acknowledges it, it escalates.
