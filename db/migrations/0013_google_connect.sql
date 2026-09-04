-- 0013_google_connect.sql — Google Business Profile connection.
-- Stores the encrypted Google OAuth tokens (refresh token) and the chosen GBP
-- location, so the agent can post to the profile and sync its reviews.

alter table brands add column if not exists google_tokens_encrypted text;
alter table brands add column if not exists gbp_account       text;   -- accounts/{id}
alter table brands add column if not exists gbp_location_id   text;   -- locations/{id}
alter table brands add column if not exists gbp_location_name text;   -- display name
alter table brands add column if not exists google_connected_at timestamptz;
