-- 0017_competitor_watches.sql — competitors the owner asked us to keep an eye on.
-- A weekly sweep researches each, diffs against last week's snapshot, and texts
-- the owner what changed + one move.

create table if not exists competitor_watches (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  name            text not null,
  handles         text,                       -- optional handles/links the owner gave
  last_snapshot   text,                       -- last week's factual snapshot, for diffing
  last_watched_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_competitor_watches_brand on competitor_watches (brand_id);
