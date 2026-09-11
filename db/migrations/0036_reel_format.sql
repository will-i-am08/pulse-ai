-- 0036_reel_format.sql — first-class Reel format + AI video job queue (Phase G).

-- posts.format: allow 'reel' (drop anonymous check from 0018, re-add named).
alter table posts drop constraint if exists posts_format_check;
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'posts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%format%'
    and pg_get_constraintdef(con.oid) ilike '%carousel%'
  limit 1;
  if cname is not null then
    execute format('alter table posts drop constraint %I', cname);
  end if;
end $$;
alter table posts add constraint posts_format_check
  check (format in ('feed', 'carousel', 'story', 'reel'));

-- pillars.format_bias: allow 'reel'.
alter table pillars drop constraint if exists pillars_format_bias_check;
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'pillars'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%format_bias%'
  limit 1;
  if cname is not null then
    execute format('alter table pillars drop constraint %I', cname);
  end if;
end $$;
alter table pillars add constraint pillars_format_bias_check
  check (format_bias is null or format_bias in ('feed', 'carousel', 'story', 'reel'));

-- Async AI video generation jobs (Kling / Runway via Replicate or fal).
create table if not exists ai_video_jobs (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  prompt          text not null,
  status          text not null default 'queued'
                    check (status in ('queued','running','ready','failed','cancelled')),
  provider        text,               -- 'replicate' | 'fal'
  model           text,               -- env-resolved model slug
  source_media_ids uuid[] not null default '{}',
  result_media_id uuid references media_assets(id) on delete set null,
  post_id         uuid references posts(id) on delete set null,
  cost_cents      int not null default 0,
  aigc            boolean not null default true,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_ai_video_jobs_brand_status
  on ai_video_jobs (brand_id, status, created_at desc);
create index if not exists idx_ai_video_jobs_queued
  on ai_video_jobs (created_at) where status = 'queued';
