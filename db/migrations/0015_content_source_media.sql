-- 0015_content_source_media.sql — let the auto-pull importer store media it
-- pulls from a connected source (Google Photos album / Drive folder), and dedupe
-- it so the same item is never imported (and drafted) twice.

-- Allow 'source' as an origin alongside client-sent and operator-uploaded media.
alter table media_assets drop constraint if exists media_assets_source_check;
alter table media_assets
  add constraint media_assets_source_check
  check (source in ('client', 'operator', 'source'));

-- The provider's own id for the item this asset was pulled from (null for
-- client/operator media). Dedup is on (brand_id, source_external_id).
alter table media_assets add column if not exists source_external_id text;

create unique index if not exists uq_media_assets_source_ref
  on media_assets (brand_id, source_external_id)
  where source_external_id is not null;
