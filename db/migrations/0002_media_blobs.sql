-- 0002_media_blobs.sql — media bytes stored in Postgres (MVP).
-- Served publicly by the dashboard at /api/media/[id] so Meta can fetch image_url
-- when publishing. Swap for Neon buckets / S3 later.

create table if not exists media_blobs (
  media_id     uuid primary key references media_assets(id) on delete cascade,
  bytes        bytea not null,
  content_type text not null,
  created_at   timestamptz not null default now()
);
