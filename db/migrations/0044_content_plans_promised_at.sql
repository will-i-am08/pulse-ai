-- 0044_content_plans_promised_at.sql
-- When Kip promises a plan "in about N minutes", we store that deadline and
-- deliver (or nudge with a fresh concrete ETA) against it.

alter table content_plans
  add column if not exists promised_at timestamptz;

create index if not exists idx_content_plans_promised
  on content_plans (promised_at)
  where status = 'pending' and promised_at is not null;
