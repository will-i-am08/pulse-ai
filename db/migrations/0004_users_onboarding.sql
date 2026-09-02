-- 0004_users_onboarding.sql — per-user accounts + signup-driven onboarding.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Each brand is owned by a user (their personalised agent). Discord user id lets
-- the bot DM them first after signup; account_type/website/onboarding_state drive
-- the setup conversation.
alter table brands add column if not exists owner_user_id   uuid references users(id) on delete cascade;
alter table brands add column if not exists discord_user_id text;
alter table brands add column if not exists account_type    text check (account_type in ('business', 'personal'));
alter table brands add column if not exists website         text;
alter table brands add column if not exists onboarding_state jsonb not null default '{"status":"none"}'::jsonb;

create index if not exists idx_brands_owner on brands (owner_user_id);
create index if not exists idx_brands_onboarding_status on brands ((onboarding_state ->> 'status'));
