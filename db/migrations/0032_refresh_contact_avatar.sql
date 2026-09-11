-- One-time re-share of Kip's contact card after switching to an opaque
-- off-white avatar (transparent PNG corners rendered black in iMessage).
-- Next outbound claims/shares once, then contact_card_sent_at is stamped again.

update brands
   set contact_card_sent_at = null,
       updated_at = now()
 where contact_card_sent_at is not null;
