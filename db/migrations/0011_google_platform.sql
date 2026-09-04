-- 0011_google_platform.sql — make Google Business Profile a first-class channel.
-- Reviews already route through the engagement engine; this lets posts target
-- Google too (publishing is live once the GBP API connection exists).

alter table posts drop constraint if exists posts_platform_check;
alter table posts add constraint posts_platform_check
  check (platform in ('instagram','facebook','google'));
