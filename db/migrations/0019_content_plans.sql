-- 0019_content_plans.sql — the niche-research custom plan built at onboarding.
-- A background agent studies the brand's niche + admired accounts, then proposes
-- a tailored content plan (pillars, cadence, format mix, best times, ideas). The
-- owner accepts it in one tap and it configures their pillars/schedule.

create table if not exists content_plans (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  niche       text,                 -- what the owner told us their business/niche is
  exemplars   text,                 -- 1–2 accounts they admire, to anchor the research
  plan        jsonb,                -- the generated playbook (null until researched)
  status      text not null default 'pending'
              check (status in ('pending', 'proposed', 'accepted', 'failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_content_plans_status on content_plans (status, created_at);
-- At most one active (pending/proposed) plan per brand.
create unique index if not exists uq_content_plans_active
  on content_plans (brand_id) where status in ('pending', 'proposed');
