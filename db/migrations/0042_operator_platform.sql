-- 0042_operator_platform.sql
-- First-party page views for operator visit metrics, operator unlock sessions
-- for OTP-gated profile edits, and expand login_codes purposes for unlock SMS.

create table if not exists page_views (
  id          uuid primary key default gen_random_uuid(),
  path        text not null,
  session_id  text,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_page_views_created on page_views (created_at desc);
create index if not exists idx_page_views_path on page_views (path);

-- Operator unlock: after verifying an SMS code sent to the target user,
-- private profile fields stay editable for this operator until expires_at.
create table if not exists operator_unlocks (
  id                uuid primary key default gen_random_uuid(),
  operator_user_id  uuid not null references users(id) on delete cascade,
  target_user_id    uuid not null references users(id) on delete cascade,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_operator_unlocks_lookup
  on operator_unlocks (operator_user_id, target_user_id, expires_at desc);

-- Allow operator_unlock purpose on login_codes (reuse OTP delivery pipeline).
alter table login_codes drop constraint if exists login_codes_purpose_check;
alter table login_codes
  add constraint login_codes_purpose_check
  check (purpose in ('login', 'signup', 'operator_unlock'));
