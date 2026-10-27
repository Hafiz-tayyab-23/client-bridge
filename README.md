# ClientBridge — NASCON Web Dev

A multi-company sales platform where every incoming lead has exactly one accountable owner. A lead escalates automatically when its owner ignores it, and every important action is traceable.

**Live:** https://nascon-web-team-034.vercel.app

## What it does
- **Accounts and access:** company workspaces, Owner/Admin/User levels, configurable permission sets ("Manager" is just a role), server-side enforcement, workspace isolation, and opportunity values hidden in lists, details and exports.
- **CRM:** contacts, companies and opportunities; custom fields (text, number, date, dropdown, checkbox), including per-pipeline fields; stage-required fields; editable pipelines; combined filters with saved dynamic lists; activity history; CSV export; and a complete customer view.
- **Leads:** captured from the public web form, Telegram messages and manual entry. Assignment is round-robin among Available employees under an open-lead limit. The acknowledgement countdown, the escalation chain (next employee, then backup, then manager) and absence reassignment are all handled server-side, plus a recovery queue showing the reason.
- **Audit and dashboard:**
  - An append-only audit log (a database trigger blocks edits and deletes) with filters.
  - A live dashboard using the official metric definitions, with drill-downs, personal or company scope, and show/hide preferences saved per user.
- **Integrations (real providers, sandbox/test modes):**
  - **Telegram bot:** customer messaging (organizer-approved replacement for Twilio) and employee escalation alerts.
  - **Safepay sandbox:** payments in PKR, a proposed replacement for Stripe. Organizer approval is pending.
  - **Google Calendar:** OAuth per employee, busy-time conflict checks, and booking, rescheduling and cancelling.

## Architecture
| Layer | Location |
|---|---|
| UI (Next.js 16 App Router, approved design system) | `src/app/(app)`, `src/components` |
| JSON API route handlers | `src/app/api/**` |
| Business rules | `src/server/services/*` |
| Provider adapters | `src/server/integrations/*` (telegram, safepay, google, stripe) |
| Data access and migrations | `src/server/db.ts`, `db/migrations/*.sql` (Postgres) |
| Background worker | `/api/worker/tick`, called every 5 s by Supabase `pg_cron` + `pg_net`; deadlines live in Postgres |

**Hosting:** Vercel (functions pinned to `icn1`, Seoul) and Supabase Postgres (ap-northeast-2), both on free tiers.

**Security:**
- bcrypt password hashes; server-side sessions that expire and can be revoked; login throttling.
- Origin-checked mutations (CSRF), Zod validation and parameterised SQL.
- Per-workspace provider credentials encrypted with AES-256-GCM, never sent to the browser.

**Concurrency:**
- A per-workspace advisory lock serialises assignment decisions.
- Each lead is re-checked under a row lock before escalating, so it never escalates twice.
- A partial unique index guarantees one open owner per lead.
- Webhooks are idempotent (receipt table).

## Running locally
```bash
npm install
cp .env.example .env          # scripts read .env
cp .env.example .env.local    # Next.js reads .env.local
npm run db:dev                # optional: local Postgres without Docker on :54329 (keep running)
npm run db:migrate
npm run dev                   # http://localhost:3000
```
For a local database use `DATABASE_URL=postgres://postgres:devpass@localhost:54329/nascon`.

Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### Environment variables (names only, never commit values)
| Name | Used for |
|---|---|
| `DATABASE_URL` | Postgres. On Vercel, the Supabase **transaction pooler** (port 6543) |
| `DATABASE_URL_DIRECT` | Migrations only: the Supabase **session pooler** (port 5432) |
| `APP_URL` | Fallback public URL (links are normally built from the request) |
| `APP_ENCRYPTION_KEY` | 32-byte base64 key that encrypts provider credentials |
| `WORKER_SECRET` | Optional; the scheduler normally uses a database-held secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client (Web application) |

Telegram and Safepay credentials are **not** environment variables. Each workspace enters them on its Integrations page, and they're stored encrypted.

## Deploying (free tiers, no card)
1. **Supabase:** create a project, then run `npm run db:migrate:cloud`, which reads `.env.cloud` with `DATABASE_URL_DIRECT` set to the session pooler.
2. **Vercel:** import the repo (framework Next.js, root `./`) and set the variables above for Production. `vercel.json` pins functions to `icn1`.
3. **Scheduler:** run `db/supabase/worker-cron.sql` in the Supabase SQL editor, replacing only the app URL.
4. **Google Cloud:**
   - Create a Web OAuth client with redirect URI `https://<app>/api/integrations/google/callback`.
   - Add the scopes `calendar.events` and `calendar.freebusy`, and add the test users.
5. In the app, go to **Integrations**:
   - **Telegram:** paste the bot token. The webhook is registered with a random secret token.
   - **Safepay:**
     1. Enter the Public API Key (`sec_…`), the Private API Secret Key and the Webhook Secret Key.
     2. In the **sandbox** Safepay dashboard, add the webhook URL shown on the card (2.0.0 events).
     3. Make sure the shared secret you saved is from that same endpoint.
6. Each employee:
   - sends `/start` to the bot and pastes the returned chat ID on **Team → My escalation alerts**;
   - connects Google Calendar on **Calendar**.

## Demo setup (about 3 minutes)
1. Sign up a workspace, invite a second employee, and on **Settings**:
   - set the acknowledgement window to 10–15 s,
   - choose yourself as Manager,
   - keep the next-employee level.
2. Both employees set their Telegram chat IDs.
3. Submit the public form (link under **Settings → Workspace**). The lead gets one owner and a countdown. Leave it unacknowledged: the server escalates it and the new owner gets a Telegram alert with a link.
4. Show the lead's ownership history, the audit log, the dashboard drill-down and the recovery queue.
5. A customer messages the bot, which creates a contact, a lead and a conversation. Reply from the app.
6. Request a Safepay PKR payment from a contact and pay it in the sandbox; the record updates.
7. Book an appointment; it appears in Google Calendar. Book over a busy slot, then reschedule and cancel.

## Tests
| Command | What it covers |
|---|---|
| `npm run smoke` | Auth, permissions, isolation, escalation, absence, throttling (31 checks) |
| `node scripts/smoke-crm.mjs` | CRM, masking, export, saved lists, audit (37) |
| `node scripts/smoke-telegram.mjs` | Webhook secret, duplicates, opt-out, failures (15) |
| `node scripts/smoke-safepay.mjs` | Webhook rejection paths (8) |
| `node scripts/smoke-stripe.mjs` | Stripe webhook logic, kept for the earlier provider (16) |
| `node scripts/e2e-browser.mjs` / `scripts/e2e-pages.mjs` | Playwright journeys at 1440 px and 390 px |

Set `BASE=` to target another deployment. These tests create isolated test workspaces.

## Known limitations (honest)
- **Telegram:**
  - It reports no delivered or read status, so messages show Sent or Failed.
  - Webhooks are authenticated by a secret-token header; Telegram doesn't sign request bodies.
  - The bot can only message people who have messaged it first.
- **Safepay:** see the Integrations page and the payment detail for the current verification status. Cancelled or expired checkouts have no documented webhook and are confirmed with an authenticated status check.
- **Google (testing mode):** only listed test users can connect, and refresh tokens may expire after 7 days. That shows as "Needs reconnect".
