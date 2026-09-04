-- 0009_campaigns.sql — time-boxed themed campaigns.
-- A campaign is proposed conversationally, approved once (pause pillars or blend),
-- then its posts are generated and scheduled across the campaign window.

create table if not exists campaigns (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  name          text not null,
  goal          text,
  status        text not null default 'proposed'
                  check (status in ('proposed','active','done','cancelled')),
  plan          jsonb not null default '[]'::jsonb,   -- proposed post items
  pause_pillars boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_campaigns_brand_status on campaigns (brand_id, status);

alter table posts add column if not exists campaign_id uuid references campaigns(id) on delete set null;
