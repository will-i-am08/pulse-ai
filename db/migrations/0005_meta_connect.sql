-- 0005_meta_connect.sql — self-serve Facebook/Instagram linking.
-- A user connects their own accounts via Facebook Login; we keep the long-lived
-- user token (to re-derive Page tokens / detect disconnects) plus display names.

alter table brands add column if not exists platform_user_token_encrypted text;
alter table brands add column if not exists fb_page_name  text;
alter table brands add column if not exists ig_username   text;
alter table brands add column if not exists meta_connected_at timestamptz;
