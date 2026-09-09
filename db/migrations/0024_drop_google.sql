-- 0024_drop_google.sql — remove Google from scope (2026-09-09).
-- Google isn't social media; GBP posting and review sync are cut. This purges
-- the Google connection data and the (unused) content-source connector
-- groundwork that was only ever for Google Photos/Drive.
--
-- Idempotent + production-safe: column/table drops use IF EXISTS, and the
-- posts.platform check is only tightened when no legacy 'google' rows exist,
-- so this migration can never fail against real data.

-- 1. Drop the Google / GBP connection columns on brands.
alter table brands drop column if exists google_tokens_encrypted;
alter table brands drop column if exists gbp_account;
alter table brands drop column if exists gbp_location_id;
alter table brands drop column if exists gbp_location_name;
alter table brands drop column if exists google_connected_at;

-- 2. Drop the unused Google Photos/Drive connector groundwork.
drop table if exists content_sources;

-- 3. Remove 'google' from the posts.platform check — only if nothing uses it.
do $$
begin
  if not exists (select 1 from posts where platform = 'google') then
    alter table posts drop constraint if exists posts_platform_check;
    alter table posts add constraint posts_platform_check
      check (platform in ('instagram','facebook','x','threads'));
  else
    raise notice 'posts still has platform=google rows; leaving the check permissive. Reassign or remove them, then re-run this migration.';
  end if;
end $$;
