-- 0016_post_chased.sql — remember when we nudged the client about a pending
-- draft, so the ~24h "still waiting your yes?" chase fires at most once per post.

alter table posts add column if not exists chased_at timestamptz;
