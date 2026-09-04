-- 0007_pillars_scheduling.sql — content pillars + the scheduling spine.
-- Each brand gets a set of content pillars (the varied "portfolio" backbone).
-- Incoming photos are auto-classified into a pillar; the scheduler slots posts
-- into smart time windows; a pillar on autopilot posts without per-post approval
-- (with a hold-window safety net).

create table if not exists pillars (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  key            text not null,                 -- stable slug, used by the classifier
  name           text not null,                 -- display name
  description    text not null default '',      -- helps the vision classifier + the client
  posts_per_week int  not null default 2,
  autopilot      boolean not null default false,
  sort           int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (brand_id, key)
);
create index if not exists idx_pillars_brand on pillars (brand_id);

-- Posts gain: which pillar they belong to, whether they're an autopilot post
-- (no human approval), and when the hold-window heads-up was sent.
alter table posts add column if not exists pillar_id        uuid references pillars(id) on delete set null;
alter table posts add column if not exists is_auto          boolean not null default false;
alter table posts add column if not exists hold_notified_at timestamptz;
