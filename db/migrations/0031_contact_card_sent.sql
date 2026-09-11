-- Persist "Kip contact card already shared" outside onboarding_state.
-- Onboarding saveState replaces the whole JSON blob and was wiping
-- kip_contact_card_sent_at, so Twilio kept re-attaching the vCard.
-- Linq share_contact_card was also only gated by an in-memory cache
-- (lost on every serverless cold start), so the profile kept re-sharing.

alter table brands
  add column if not exists contact_card_sent_at timestamptz;

-- Carry over any legacy jsonb stamp that survived.
update brands
   set contact_card_sent_at = (onboarding_state->>'kip_contact_card_sent_at')::timestamptz
 where contact_card_sent_at is null
   and onboarding_state->>'kip_contact_card_sent_at' is not null
   and onboarding_state->>'kip_contact_card_sent_at' ~ '^[0-9]';

-- Anyone who already has an outbound thread almost certainly received the
-- card (or does not need another push). Stops re-spamming existing clients.
update brands
   set contact_card_sent_at = now()
 where contact_card_sent_at is null
   and exists (
     select 1 from messages m
      where m.brand_id = brands.id
        and m.direction = 'outbound'
   );
