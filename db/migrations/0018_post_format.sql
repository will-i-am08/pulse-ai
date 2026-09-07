-- 0018_post_format.sql — vary what the bot posts: feed / carousel / story.
-- Reels (video) parked for later. Existing posts default to 'feed'.

alter table posts add column if not exists format text not null default 'feed'
  check (format in ('feed', 'carousel', 'story'));
