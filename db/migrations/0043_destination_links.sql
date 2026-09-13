-- 0043_destination_links.sql
-- Destination / booking URLs on organic posts + private-reply fulfillment ledger.
-- Distinct from SMS connect deep-links (/c/[token]).

alter table posts
  add column if not exists link_offer jsonb;

comment on column posts.link_offer is
  'Confirmed destination link offer for this post: {url, mode, keyword?, confirmed_at}. '
  'mode: comment_dm | caption_url | story_cta | ad_destination.';

alter table interactions
  add column if not exists post_id uuid references posts(id) on delete set null,
  add column if not exists media_external_id text,
  add column if not exists link_fulfillment jsonb;

comment on column interactions.post_id is
  'Optional Kip post this comment/DM relates to (when resolvable).';
comment on column interactions.media_external_id is
  'Platform media id from Meta webhook (comment on media), used to match published posts.';
comment on column interactions.link_fulfillment is
  'Private-reply / DM link send ledger: {method, url, sent_at, external_message_id?}';

create index if not exists interactions_post_id_idx
  on interactions (post_id)
  where post_id is not null;

create index if not exists interactions_media_external_id_idx
  on interactions (brand_id, media_external_id)
  where media_external_id is not null;

create index if not exists posts_link_offer_idx
  on posts (brand_id)
  where link_offer is not null;
