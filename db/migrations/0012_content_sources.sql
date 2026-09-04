-- 0012_content_sources.sql — connected photo sources (Phase C).
-- A brand links a Google Photos album / Drive folder; the agent polls it for
-- new media and imports it into the queue. The OAuth connect is gated on the
-- same Google Cloud project as GBP; this table is the groundwork.

create table if not exists content_sources (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  kind            text not null check (kind in ('google_photos','google_drive','dropbox')),
  external_ref    text,                       -- album/folder id
  encrypted_token text,                       -- OAuth token, encrypted at rest
  cursor          text,                       -- pagination/sync cursor
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_content_sources_brand on content_sources (brand_id);
