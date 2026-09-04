-- 0010_engagement.sql — Phase A: business-facts profile + inbound engagement.

-- The living business profile that powers auto-replies and (later) Google posts.
alter table brands add column if not exists facts  jsonb not null default '{}'::jsonb;
alter table brands add column if not exists visual jsonb not null default '{}'::jsonb;

-- Inbound interactions (comments, DMs, mentions, reviews) and their replies.
create table if not exists interactions (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  platform    text not null,                                   -- instagram|facebook|google|...
  kind        text not null check (kind in ('comment','dm','mention','review')),
  external_id text,
  author      text,
  text        text,
  sentiment   text,                                            -- positive|neutral|negative
  bucket      text,                                            -- lead|support|general|spam
  status      text not null default 'new'
                check (status in ('new','auto_replied','drafted','escalated','resolved','hidden')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_interactions_brand on interactions (brand_id, status, created_at);

create table if not exists interaction_replies (
  id               uuid primary key default gen_random_uuid(),
  interaction_id   uuid not null references interactions(id) on delete cascade,
  brand_id         uuid not null references brands(id) on delete cascade,
  body             text not null,
  actor            text not null,                              -- agent|owner
  status           text not null default 'draft' check (status in ('draft','sent')),
  external_reply_id text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_interaction_replies_interaction on interaction_replies (interaction_id);
