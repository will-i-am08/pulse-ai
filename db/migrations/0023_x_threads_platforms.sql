-- 0023_x_threads_platforms.sql — X and Threads as publish destinations.
-- Mock/fake-feed only (no live APIs, no API keys). Destinations[] is the
-- owner-picked channel list for a draft; empty means "whatever posts.platform
-- already is" so existing Instagram / Facebook / Google rows stay unchanged.

alter table posts drop constraint if exists posts_platform_check;
alter table posts add constraint posts_platform_check
  check (platform in ('instagram','facebook','google','x','threads'));

alter table posts add column if not exists destinations text[] not null default '{}';
alter table posts add column if not exists captions jsonb not null default '{}'::jsonb;
