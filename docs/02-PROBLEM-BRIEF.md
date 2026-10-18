# Live Problem Brief — Unified Business Management Platform

## Source and authority
The uploaded `problem statement.pdf` is the authoritative prompt. This file is a working summary. Preserve the original PDF and check it whenever a detail is unclear.

## Problem to solve
Small service businesses lose leads when responses are late or missed. Customer records, conversations, payments, appointments, and employee activity are scattered across tools, so teams cannot reliably assign responsibility or see what happened.

Build one connected web platform where a company can manage customers and its sales pipeline, ensure every lead has an accountable owner and escalate ignored leads, and connect real messaging, payment, and calendar services. Important actions must be traceable.

## Users
- **Owner:** controls the company workspace, users, permissions, and settings; needs confidence leads are handled and a clear performance view.
- **Admin:** configures CRM fields, pipelines, assignment rules, and integrations.
- **Manager:** a configurable permission set, not a fourth fixed role; monitors availability and overdue leads and can reassign them.
- **Sales/support employee (User):** handles assigned leads, conversations, notes, payments, and appointments.
- **Customer:** contacts the company and expects a timely response, payment link, and appointment confirmation.

The three base levels are Owner, Admin, and User. Permissions must be configurable and enforced on the server.

## Required scope

### 1. Accounts, permissions, and workspace isolation
- Sign-up creates a company workspace and makes the first user its Owner.
- Support persistent login, logout, and invitations/role assignment.
- Allow configurable view/create/edit/delete/export permissions for CRM data, plus assignment, integration, and audit permissions.
- Enforce permissions on every relevant server endpoint; hiding buttons alone is insufficient.
- Enforce strict company/workspace data isolation, including for guessed record IDs.
- Hide or mask opportunity values from users without permission in lists, detail pages, and exports.

### 2. Customizable CRM
- Store contacts, companies, and opportunities with their relationships.
- Let Admins create text, number, date, dropdown, and checkbox fields through the UI.
- Support different fields by pipeline and required fields by stage.
- Let Admins add, rename, reorder, and safely delete pipeline stages; move opportunities between stages.
- Support filtering by at least three criteria and saving dynamic lists.
- Show a time-ordered activity history on contacts and opportunities.
- Provide a complete contact view with conversations, opportunities, payments, appointments, assigned employee, and history.

### 3. Lead capture, ownership, acknowledgement, and escalation
This is the central problem: every lead must have exactly one accountable owner at a time.
- Capture leads from a public form, manual entry, and incoming messages; label each source.
- Track employee availability: Available, Busy, On leave, or Offline.
- Let Admins configure round-robin assignment among Available employees and a maximum open-lead limit.
- Notify the assignee and show a configurable acknowledgement countdown.
- If the lead is ignored, automatically escalate through eligible employees, a designated backup, and then a manager. Make levels and time windows configurable.
- Reassign unacknowledged leads immediately when an employee goes On leave or Offline; define and show what happens to acknowledged leads.
- Provide a recovery queue for overdue, repeatedly escalated, or inactive leads.
- Prevent duplicate ownership and duplicate escalation when timers or events occur concurrently.
- Send an external notification when a lead escalates.

### 4. Audit history
- Record assignments, acknowledgements, escalations, role/permission changes, CRM configuration changes, integration changes, and deletions.
- Record actor or system, time, target, and relevant before/after values.
- Restrict access by audit permission; support filtering by event, user, and date.
- Do not allow audit entries to be edited or deleted through the app.

### 5. Operational dashboard
Use live stored data to show:
- New leads today and open pipeline value by stage.
- Average time to first response.
- Recovery queue items and escalations in the last 24 hours.
- Employee availability, upcoming appointments, and payments received this month.
- At least three figures should open the corresponding filtered records.
- Show personal figures to Users and company-wide figures to authorized Owner/Admin users.
- Let users show or hide figures and remember their choice.
- Use the prompt’s metric definitions consistently. Collected revenue must reflect confirmed payments minus confirmed refunds.

## Mandatory real integrations
Use provider sandbox/test modes. Do not replace these with fake or hard-coded stand-ins.

- **Messaging (I1):** Twilio WhatsApp Sandbox; Twilio SMS is an accepted alternative. Receive and send real test messages, verify webhook signatures, show delivery/failure status, match contacts, handle duplicate webhooks, support opt-out, and preserve failed messages for retry.
- **Payments (I2):** Stripe test mode. Create a payment link/checkout from an opportunity; update status from verified webhooks; handle duplicate events, failure/expiry/refund, and show traceable payment records. Never store or log card numbers.
- **Calendar (I3):** Google Calendar through OAuth 2.0. Connect/disconnect each employee’s account, keep tokens server-side, create and update real events, check conflicts, handle time zones, and show connection status.
- **Choose one additional notification provider (I4):** Slack, Telegram bot, or transactional email. Deliver escalation alerts within the same minute, route per employee, record failures, and retry a limited number of times.
- **Shared integration requirements (I5):** show integration status and recent errors; isolate credentials by workspace; keep secrets server-side and out of Git/UI; record synchronization events; retry temporary failures; explain permanent failures; keep other platform features working if one provider fails.

## Quality requirements
- Real database persistence that survives restarts; workspace configuration is stored.
- Secure authentication, server-side authorization, validated input, and protection against injection, XSS, and CSRF.
- Correct behavior for concurrent assignments, timers, and duplicate webhooks.
- Responsive phone/tablet/laptop layouts with no horizontal scrolling.
- Keyboard-accessible controls, labeled forms, readable contrast, and status communicated without color alone.
- Paginated or equivalent handling for hundreds of records; show progress during slow actions.
- Every action has loading, success, and failure feedback with useful next steps.
- New leads, escalations, and incoming messages appear without manual refresh.
- Keep secrets outside source code and provide setup instructions and sample data.
- Separate business rules, data access, integrations, and presentation.

## Explicitly out of scope
- Full accounting, ledgers, reconciliation, and financial statements.
- Payroll, shift scheduling, and legal leave/break management.
- Advertising analytics and campaign attribution.
- Full report builder/business intelligence.
- Training/onboarding modules and AI role-play.
- Public marketing website and billing for the platform itself.

## Demo success path
Show a lead arriving, receiving one accountable owner, and being acknowledged or automatically escalated when the configured timer expires. Show the new owner and external notification, then open the lead’s audit/activity history and the relevant dashboard/recovery queue. Also demonstrate the required real integration flows in their provider test/sandbox modes.

## Constraints and open questions
- The prompt requires real stored data and real provider integrations; demo timers and thresholds must be configurable to run in seconds.
- Deployment must provide a live link, per the competition rules.
- The exact framework/language is not specified in the prompt.
- The judging rubric and scoring weights were not included.
- Confirm with organizers whether all listed requirements are expected in the judged build and how partial completion is scored.
- Confirm that Claude/AI-generated code, Stitch, internet access, external APIs, component libraries, and starter code are allowed under the competition rules.
- Confirm the official development start time and how the 6-hour-45-minute duration fits the 4:00 PM code cutoff.

## Planning warning
This is a very large scope for a 6-hour-45-minute competition. Treat the listed requirements as required unless organizers clarify otherwise. Do not claim integrations or features work unless they use real data and pass an end-to-end check. Prioritize a complete, demonstrable lead lifecycle while tracking the remaining mandatory requirements explicitly.