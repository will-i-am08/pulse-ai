-- 0025_x_account.sql — connect a real X (Twitter) account per brand.
-- OAuth 2.0 (PKCE) user tokens are stored encrypted; presence of x_tokens_encrypted
-- + X_CLIENT_ID in env is what flips X from mock to live posting for a brand.

alter table brands add column if not exists x_user_id text;
alter table brands add column if not exists x_username text;
alter table brands add column if not exists x_tokens_encrypted text;
