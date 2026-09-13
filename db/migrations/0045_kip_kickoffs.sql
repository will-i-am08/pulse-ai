-- Kip self-kickoffs: work Kip queues for itself when the user asks, when Kip
-- commits to doing something, or when a proactive loop spots a trend/competitor move.
create table if not exists kip_kickoffs (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) on delete cascade,
  kind              text not null
                      check (kind in (
                        'first_batch',
                        'draft_posts',
                        'trend_draft',
                        'competitor_draft'
                      )),
  status            text not null default 'queued'
                      check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  payload           jsonb not null default '{}'::jsonb,
  reason            text not null default 'system'
                      check (reason in ('user_request', 'kip_commit', 'system', 'proactive')),
  source_message_id uuid,
  error             text,
  result            jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

create index if not exists idx_kip_kickoffs_queued
  on kip_kickoffs (created_at)
  where status = 'queued';

create index if not exists idx_kip_kickoffs_brand_status
  on kip_kickoffs (brand_id, status, created_at desc);

-- One active (queued/running) kickoff per brand+kind — avoid stampeding duplicates.
create unique index if not exists idx_kip_kickoffs_active_brand_kind
  on kip_kickoffs (brand_id, kind)
  where status in ('queued', 'running');
