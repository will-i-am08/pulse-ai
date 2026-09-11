-- 0034_research_strategy.sql — Phase D: research snapshots, visual exemplars,
-- strategy briefs for SMS approval, pillar format_bias, campaign pause status.

-- Persisted research Kip can cite ("last week we found…").
create table if not exists research_snapshots (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  kind        text not null
                check (kind in ('niche', 'competitor', 'customers', 'ads', 'strategy', 'plan')),
  subject     text,                          -- niche phrase, competitor name, etc.
  summary     text not null default '',      -- SMS-citable plain-text summary
  findings    jsonb not null default '{}'::jsonb,
  -- pain_language, competitor_hooks, competitor_ctas, ad_library_angles,
  -- organic_themes, sources, notes, etc.
  created_at  timestamptz not null default now()
);
create index if not exists idx_research_snapshots_brand_created
  on research_snapshots (brand_id, created_at desc);
create index if not exists idx_research_snapshots_brand_kind
  on research_snapshots (brand_id, kind, created_at desc);

-- Public visual exemplars for the design composer (URLs or media refs).
create table if not exists visual_exemplars (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  snapshot_id   uuid references research_snapshots(id) on delete set null,
  source        text not null default 'research'
                  check (source in ('niche', 'competitor', 'research')),
  url           text,                        -- public https URL (SSRF-checked before store)
  media_id      uuid references media_assets(id) on delete set null,
  label         text,
  notes         text,
  competitor_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_visual_exemplars_brand_created
  on visual_exemplars (brand_id, created_at desc);

-- Strategy brief awaiting SMS accept-all / accept-parts / revise.
create table if not exists strategy_briefs (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  status      text not null default 'proposed'
                check (status in ('proposed', 'accepted', 'revised', 'cancelled')),
  -- Proposed pieces: { icp?, pains?, positioning?, offers?, summary }
  pieces      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_strategy_briefs_brand_status
  on strategy_briefs (brand_id, status, created_at desc);
-- At most one open brief per brand.
create unique index if not exists uq_strategy_briefs_proposed
  on strategy_briefs (brand_id) where status = 'proposed';

-- Per-pillar format bias from accepted content plans (gap-fill / chooseNextFormat).
alter table pillars add column if not exists format_bias text
  check (format_bias is null or format_bias in ('feed', 'carousel', 'story'));

-- Organic campaign pause (resume returns to active).
alter table campaigns drop constraint if exists campaigns_status_check;
alter table campaigns add constraint campaigns_status_check
  check (status in ('proposed', 'active', 'paused', 'done', 'cancelled'));
