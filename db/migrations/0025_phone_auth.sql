-- 0025_phone_auth.sql — phone-number identity + passwordless OTP login.
-- Phone becomes the primary login identifier; a short-lived code is delivered
-- through the user's own agent thread and entered on the dashboard. Email and
-- password become optional: email is kept for receipts/notifications, password
-- only as an operator break-glass.

-- Phone on users (unique when set). Existing rows keep null until they add one.
alter table users add column if not exists phone text;
create unique index if not exists uq_users_phone on users (phone) where phone is not null;

-- Email + password are no longer required (passwordless signup).
alter table users alter column email drop not null;
alter table users alter column password_hash drop not null;

-- One-time login codes. The code is stored ENCRYPTED (never plaintext) so the
-- agent process can deliver it asynchronously via whatever channel the user's
-- brand uses. Single-use, short-lived, attempt-capped.
create table if not exists login_codes (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null,
  user_id        uuid references users(id) on delete cascade,
  brand_id       uuid references brands(id) on delete set null,
  code_encrypted text not null,
  purpose        text not null default 'login' check (purpose in ('login', 'signup')),
  attempts       int not null default 0,
  delivered_at   timestamptz,
  consumed_at    timestamptz,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_login_codes_phone on login_codes (phone, created_at desc);
-- Fast lookup for the delivery poller: undelivered, unconsumed codes.
create index if not exists idx_login_codes_pending on login_codes (created_at)
  where delivered_at is null and consumed_at is null;
