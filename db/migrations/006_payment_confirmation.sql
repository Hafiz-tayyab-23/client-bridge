-- 006_payment_confirmation: bounded automatic provider status checks + honest confirmation source.
alter table payments add column provider_check_attempts int not null default 0;
alter table payments add column next_provider_check_at timestamptz;
alter table payments add column confirmation_source text;
create index payments_provider_check on payments (next_provider_check_at) where status = 'pending' and provider = 'safepay';
