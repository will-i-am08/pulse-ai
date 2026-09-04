-- 0006_post_source_media.sql — remember each post's original photo + styling
-- recipe, so an image-edit request re-styles from the source instead of
-- compounding edits on an already-styled/tiled image.

alter table posts add column if not exists source_media_ids uuid[];
alter table posts add column if not exists style_meta jsonb not null default '{}'::jsonb;
