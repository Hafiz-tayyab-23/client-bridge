-- 005_safepay: Safepay as an additional (proposed) payment provider; Stripe remains.
alter table integration_connections drop constraint integration_connections_provider_check;
alter table integration_connections add constraint integration_connections_provider_check check (provider in ('twilio','stripe','google','telegram','safepay'));
alter table payments add column provider text not null default 'stripe' check (provider in ('stripe','safepay'));
alter table payments drop constraint payments_status_check;
alter table payments add constraint payments_status_check check (status in ('pending','paid','failed','expired','cancelled','refunded','partially_refunded'));
