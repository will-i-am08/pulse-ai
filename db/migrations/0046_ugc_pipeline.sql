-- 0046_ugc_pipeline.sql — multi-scene UGC jobs + auto-tune log (Phase G2).

-- Extend ai_video_jobs for UGC pipeline (routed stills → routed I2V [Kling/Seedance/Wan] → VO → assemble).
alter table ai_video_jobs
  add column if not exists kind text not null default 't2v'
    check (kind in ('t2v', 'ugc'));

alter table ai_video_jobs
  add column if not exists destination text not null default 'organic'
    check (destination in ('organic', 'ads', 'both'));

alter table ai_video_jobs
  add column if not exists pipeline jsonb not null default '{}'::jsonb;

alter table ai_video_jobs
  add column if not exists preset_version text;

create index if not exists idx_ai_video_jobs_kind_queued
  on ai_video_jobs (created_at)
  where status = 'queued' and kind = 'ugc';

-- Per-scene / per-job auto-tune scores and winning prompt deltas.
create table if not exists ugc_tune_log (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references brands(id) on delete set null,
  job_id          uuid references ai_video_jobs(id) on delete set null,
  preset_id       text not null,
  scene_index     int,
  scores          jsonb not null default '{}'::jsonb,
  prompt_delta    jsonb not null default '{}'::jsonb,
  passed          boolean not null default false,
  promoted        boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ugc_tune_log_brand
  on ugc_tune_log (brand_id, created_at desc);

create index if not exists idx_ugc_tune_log_preset
  on ugc_tune_log (preset_id, created_at desc);
