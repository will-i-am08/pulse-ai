-- 0033_brand_context.sql — Phase B: ICP, pains, positioning, offers + design memory.
-- Visual tokens stay on brands.visual (jsonb); structured strategy objects get columns.

alter table brands add column if not exists icp jsonb not null default '{}'::jsonb;
alter table brands add column if not exists pain_points jsonb not null default '{}'::jsonb;
alter table brands add column if not exists positioning jsonb not null default '{}'::jsonb;
alter table brands add column if not exists offers jsonb not null default '{}'::jsonb;

-- Own design memory: approved / published / top creatives the composer can cite.
create table if not exists design_memory (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  media_id    uuid references media_assets(id) on delete set null,
  post_id     uuid references posts(id) on delete set null,
  kind        text not null default 'creative'
                check (kind in ('creative', 'carousel_slide', 'story', 'quote_card')),
  status      text not null default 'approved'
                check (status in ('approved', 'published', 'top')),
  notes       text,
  score       double precision,
  created_at  timestamptz not null default now()
);

create index if not exists idx_design_memory_brand_created
  on design_memory (brand_id, created_at desc);

create index if not exists idx_design_memory_brand_score
  on design_memory (brand_id, score desc nulls last);
