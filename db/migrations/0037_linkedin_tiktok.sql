-- 0037_linkedin_tiktok.sql — Phase H: LinkedIn Company Page + TikTok Direct Post.
-- Token columns on brands; posts.platform check extended for destinations.
-- TikTok public live is still gated in code by TIKTOK_AUDIT_PASSED.

alter table brands add column if not exists linkedin_org_id text;
alter table brands add column if not exists linkedin_org_name text;
alter table brands add column if not exists linkedin_tokens_encrypted text;
alter table brands add column if not exists linkedin_connected_at timestamptz;

alter table brands add column if not exists tiktok_open_id text;
alter table brands add column if not exists tiktok_display_name text;
alter table brands add column if not exists tiktok_tokens_encrypted text;
alter table brands add column if not exists tiktok_connected_at timestamptz;
alter table brands add column if not exists tiktok_privacy_defaults jsonb not null default '{
  "privacy_level": "PUBLIC_TO_EVERYONE",
  "allow_comment": true,
  "allow_duet": true,
  "allow_stitch": true,
  "music_usage_confirmed": false,
  "aigc_disclosure": true
}'::jsonb;

alter table posts drop constraint if exists posts_platform_check;
alter table posts add constraint posts_platform_check
  check (platform in ('instagram','facebook','x','threads','linkedin','tiktok'));
