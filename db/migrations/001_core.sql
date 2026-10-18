-- 001_core: accounts, workspaces, permissions, CRM, leads, audit, integrations.
-- Every business table carries workspace_id; all queries are scoped by it in the data layer.

create extension if not exists pgcrypto;

-- ------------------------- Accounts & workspaces (F1) -------------------------
create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 120),
  timezone    text not null default 'Asia/Karachi',
  created_at  timestamptz not null default now()
);

-- Named permission sets. "Manager" is just a role row, not a hard-coded level (F1.2/F1.3).
create table roles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  permissions   text[] not null default '{}',
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

create table users (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  email            text not null,
  name             text not null check (length(name) between 1 and 120),
  password_hash    text not null,
  base_role        text not null check (base_role in ('owner','admin','user')),
  role_id          uuid references roles(id) on delete set null,
  availability     text not null default 'available'
                   check (availability in ('available','busy','on_leave','offline')),
  telegram_chat_id text,
  timezone         text not null default 'Asia/Karachi',
  prefs            jsonb not null default '{}',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index users_email_unique on users (lower(email));
create index users_workspace on users (workspace_id);
-- Exactly one owner per workspace.
create unique index users_one_owner on users (workspace_id) where base_role = 'owner';

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  user_agent   text,
  ip           text
);
create index sessions_user on sessions (user_id);

create table login_attempts (
  id          bigserial primary key,
  email       text not null,
  ip          text,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index login_attempts_email_time on login_attempts (lower(email), created_at desc);
create index login_attempts_ip_time on login_attempts (ip, created_at desc);

create table invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  email         text not null,
  name          text not null,
  base_role     text not null check (base_role in ('admin','user')),
  role_id       uuid references roles(id) on delete set null,
  token_hash    text not null unique,
  invited_by    uuid references users(id) on delete set null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index invitations_workspace on invitations (workspace_id);

-- ------------------------- CRM (F2) -------------------------
create table pipelines (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index pipelines_workspace on pipelines (workspace_id);

create table stages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  pipeline_id   uuid not null references pipelines(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  position      int not null default 0,
  kind          text not null default 'open' check (kind in ('open','won','lost')),
  created_at    timestamptz not null default now()
);
create index stages_pipeline on stages (pipeline_id, position);

create table custom_fields (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  entity        text not null check (entity in ('contact','company','opportunity')),
  pipeline_id   uuid references pipelines(id) on delete cascade, -- opportunity fields per pipeline (F2.3)
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         text not null check (length(label) between 1 and 80),
  type          text not null check (type in ('text','number','date','dropdown','checkbox')),
  options       text[] not null default '{}',
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index custom_fields_key on custom_fields (workspace_id, entity, coalesce(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- Stage-specific required fields (F2.4). Cascades keep data consistent (Q4).
create table stage_required_fields (
  stage_id  uuid not null references stages(id) on delete cascade,
  field_id  uuid not null references custom_fields(id) on delete cascade,
  primary key (stage_id, field_id)
);

create table companies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null check (length(name) between 1 and 160),
  domain        text,
  custom        jsonb not null default '{}',
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index companies_workspace on companies (workspace_id, name);

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  company_id    uuid references companies(id) on delete set null,
  name          text not null check (length(name) between 1 and 160),
  email         text,
  phone         text, -- E.164
  tags          text[] not null default '{}',
  owner_id      uuid references users(id) on delete set null,
  opted_out     boolean not null default false,
  opted_out_at  timestamptz,
  custom        jsonb not null default '{}',
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index contacts_workspace on contacts (workspace_id, created_at desc);
create unique index contacts_phone_unique on contacts (workspace_id, phone) where phone is not null;

create table opportunities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  pipeline_id   uuid not null references pipelines(id) on delete restrict,
  stage_id      uuid not null references stages(id) on delete restrict,
  contact_id    uuid references contacts(id) on delete set null,
  company_id    uuid references companies(id) on delete set null,
  title         text not null check (length(title) between 1 and 160),
  value_cents   bigint not null default 0 check (value_cents >= 0),
  currency      text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  owner_id      uuid references users(id) on delete set null,
  custom        jsonb not null default '{}',
  version       int not null default 1,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index opportunities_workspace on opportunities (workspace_id, stage_id);

create table saved_lists (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  entity        text not null check (entity in ('contact','opportunity','lead')),
  filters       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- Time-ordered activity history per contact / opportunity / lead (F2.7).
create table activities (
  id              bigserial primary key,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete cascade,
  lead_id         uuid,
  actor_id        uuid references users(id) on delete set null,
  type            text not null,
  summary         text not null,
  data            jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index activities_contact on activities (contact_id, created_at desc);
create index activities_opportunity on activities (opportunity_id, created_at desc);
create index activities_lead on activities (lead_id, created_at desc);

-- ------------------------- Leads & assignment (F3) -------------------------
create table assignment_rules (
  workspace_id        uuid primary key references workspaces(id) on delete cascade,
  strategy            text not null default 'round_robin' check (strategy in ('round_robin')),
  max_open_leads      int not null default 10 check (max_open_leads between 1 and 1000),
  ack_window_seconds  int not null default 300 check (ack_window_seconds between 5 and 604800),
  -- ordered levels: [{"type":"next_employee"|"backup"|"manager","window_seconds":n}]
  levels              jsonb not null default '[{"type":"next_employee","window_seconds":300},{"type":"backup","window_seconds":300},{"type":"manager","window_seconds":600}]',
  backup_user_id      uuid references users(id) on delete set null,
  manager_user_id     uuid references users(id) on delete set null,
  idle_seconds        int not null default 86400 check (idle_seconds between 10 and 2592000),
  absence_policy      text not null default 'keep_acknowledged'
                      check (absence_policy in ('keep_acknowledged','reassign_all')),
  rr_last_user_id     uuid references users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create table leads (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  contact_id             uuid references contacts(id) on delete set null,
  opportunity_id         uuid references opportunities(id) on delete set null,
  source                 text not null check (source in ('web_form','message','manual')),
  source_detail          text,
  title                  text not null,
  message                text,
  status                 text not null default 'new' check (status in ('new','assigned','acknowledged','closed')),
  owner_id               uuid references users(id) on delete set null,
  assigned_at            timestamptz,
  first_assigned_at      timestamptz,
  ack_deadline           timestamptz,
  acknowledged_at        timestamptz,
  first_acknowledged_at  timestamptz,
  escalation_level       int not null default 0,
  escalation_count       int not null default 0,
  chain_exhausted        boolean not null default false,
  last_action_at         timestamptz not null default now(),
  version                int not null default 1,
  closed_at              timestamptz,
  created_at             timestamptz not null default now()
);
create index leads_workspace on leads (workspace_id, created_at desc);
create index leads_deadline on leads (ack_deadline) where status = 'assigned' and ack_deadline is not null;
create index leads_owner on leads (owner_id) where status in ('assigned','acknowledged');

-- Assignment history; at most one open assignment per lead (F3.8, enforced by the database).
create table lead_assignments (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  lead_id       uuid not null references leads(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  kind          text not null check (kind in ('initial','escalation','manual','absence')),
  level         int not null default 0,
  reason        text,
  assigned_at   timestamptz not null default now(),
  ended_at      timestamptz
);
create unique index lead_assignments_one_open on lead_assignments (lead_id) where ended_at is null;

-- ------------------------- Notifications (in-app + I4 outbox) -------------------------
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  user_id          uuid references users(id) on delete cascade,
  lead_id          uuid references leads(id) on delete cascade,
  channel          text not null check (channel in ('in_app','telegram')),
  kind             text not null,
  title            text not null,
  body             text not null,
  link             text,
  status           text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts         int not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  sent_at          timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_user on notifications (user_id, created_at desc);
create index notifications_pending on notifications (next_attempt_at) where status = 'pending' and channel <> 'in_app';

-- ------------------------- Integrations (I1-I5) -------------------------
create table integration_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  provider         text not null check (provider in ('twilio','stripe','google','telegram')),
  user_id          uuid references users(id) on delete cascade, -- per-employee (Google)
  status           text not null default 'not_connected'
                   check (status in ('not_connected','connected','error','needs_reconnect')),
  config           jsonb not null default '{}',   -- non-secret settings only
  secrets_enc      text,                           -- AES-256-GCM, never sent to the browser
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index integration_connections_unique on integration_connections
  (workspace_id, provider, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table integration_events (
  id            bigserial primary key,
  workspace_id  uuid references workspaces(id) on delete cascade,
  provider      text not null,
  direction     text not null check (direction in ('inbound','outbound')),
  kind          text not null,
  status        text not null check (status in ('ok','error','rejected','duplicate','retrying')),
  reference     text,
  summary       text,
  error         text,
  created_at    timestamptz not null default now()
);
create index integration_events_ws on integration_events (workspace_id, created_at desc);

-- Webhook idempotency (I1.8, I2.4).
create table webhook_receipts (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

create table conversations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  contact_id       uuid not null references contacts(id) on delete cascade,
  channel          text not null check (channel in ('whatsapp','sms')),
  assignee_id      uuid references users(id) on delete set null,
  opportunity_id   uuid references opportunities(id) on delete set null,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (workspace_id, contact_id, channel)
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  direction        text not null check (direction in ('inbound','outbound')),
  body             text not null,
  provider_sid     text,
  status           text not null check (status in ('received','queued','sending','sent','delivered','read','failed','undelivered')),
  error_code       text,
  error_message    text,
  sender_id        uuid references users(id) on delete set null,
  attempts         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index messages_provider_sid on messages (provider_sid) where provider_sid is not null;
create index messages_conversation on messages (conversation_id, created_at);

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  opportunity_id     uuid references opportunities(id) on delete set null,
  contact_id         uuid references contacts(id) on delete set null,
  requested_by       uuid references users(id) on delete set null,
  amount_cents       bigint not null check (amount_cents > 0),
  currency           text not null check (currency ~ '^[a-z]{3}$'),
  status             text not null default 'pending'
                     check (status in ('pending','paid','failed','expired','refunded','partially_refunded')),
  provider_session   text unique,
  provider_intent    text,
  url                text,
  refunded_cents     bigint not null default 0,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index payments_workspace on payments (workspace_id, created_at desc);

create table appointments (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  contact_id       uuid references contacts(id) on delete set null,
  opportunity_id   uuid references opportunities(id) on delete set null,
  user_id          uuid references users(id) on delete set null,
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null check (ends_at > starts_at),
  timezone         text not null,
  provider_event   text,
  status           text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index appointments_workspace on appointments (workspace_id, starts_at);

-- ------------------------- Audit history (F4) -------------------------
create table audit_log (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  actor_id      uuid references users(id) on delete set null,
  actor_label   text not null, -- user name/email at the time, or 'system'
  event         text not null,
  target_type   text not null,
  target_id     text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_ws on audit_log (workspace_id, created_at desc);

-- Tamper resistance (F4.3): rows can be inserted, never edited or deleted.
-- (A workspace cascade-delete is the only path that removes rows.)
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.actor_id is null and old.actor_id is not null and
       (new.id, new.workspace_id, new.actor_label, new.event, new.target_type, new.target_id, new.before, new.after, new.created_at)
       is not distinct from
       (old.id, old.workspace_id, old.actor_label, old.event, old.target_type, old.target_id, old.before, old.after, old.created_at) then
      return new; -- allow ON DELETE SET NULL from users
    end if;
    raise exception 'audit_log is append-only';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from workspaces where id = old.workspace_id) then
    raise exception 'audit_log is append-only';
  end if;
  return old;
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
