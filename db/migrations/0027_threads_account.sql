-- 0026_threads_account.sql — connect a real Threads account per brand.
-- Threads API (Meta) long-lived tokens are stored encrypted; presence of
-- threads_tokens_encrypted + THREADS_APP_ID in env flips Threads from mock to live.

alter table brands add column if not exists threads_user_id text;
alter table brands add column if not exists threads_username text;
alter table brands add column if not exists threads_tokens_encrypted text;
