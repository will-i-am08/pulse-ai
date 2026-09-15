-- 0050_posts_last_offered_at.sql
--
-- Which pending draft does a bare "yes" mean?
--
-- The router resolved it with `order by created_at desc limit 1`, but
-- runFirstBatch drafts N posts CONCURRENTLY and texts each one separately
-- ("Batch 1/3 … Reply \"yes\" to approve"). created_at order is whatever the
-- inserts happened to win, which does not match SMS delivery order — so "yes"
-- to batch 1/3 approved whichever row landed last, and "make that one shorter"
-- edited a draft the client was not even looking at.
--
-- `last_offered_at` records when a draft was last PUT IN FRONT OF THE CLIENT.
-- The router orders by coalesce(last_offered_at, created_at), so rows that
-- predate this column keep their old behaviour and nothing needs backfilling.

alter table posts add column if not exists last_offered_at timestamptz;

create index if not exists idx_posts_brand_pending_offered
  on posts (brand_id, last_offered_at desc nulls last)
  where status = 'pending_approval';
