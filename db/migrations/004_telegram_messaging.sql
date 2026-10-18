-- 004_telegram_messaging: Telegram replaces Twilio for I1 (organizer-permitted).
alter table contacts add column telegram_chat_id text;
create unique index contacts_telegram_unique on contacts (workspace_id, telegram_chat_id) where telegram_chat_id is not null;
alter table conversations drop constraint conversations_channel_check;
alter table conversations add constraint conversations_channel_check check (channel in ('whatsapp','sms','telegram'));
alter table conversations add column last_inbound_at timestamptz;
alter table conversations add column read_at timestamptz;
