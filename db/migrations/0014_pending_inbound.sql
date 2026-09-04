-- 0014_pending_inbound.sql — lightweight inbound queue.
-- The web webhook (serverless, no native image libs) only ingests an inbound
-- message here; the bot/worker (which has sharp/resvg) picks it up, runs the
-- full pipeline, and replies. Keeps heavy processing off the serverless function.

create table if not exists pending_inbound (
  id                  uuid primary key default gen_random_uuid(),
  channel             text not null,                 -- linq | ...
  from_handle         text not null,                 -- sender (E.164 for linq)
  body                text,
  media               jsonb not null default '[]'::jsonb,   -- [{url,contentType}]
  provider_message_id text,
  status              text not null default 'new' check (status in ('new','done','failed')),
  created_at          timestamptz not null default now()
);
create index if not exists idx_pending_inbound_status on pending_inbound (status, created_at);
