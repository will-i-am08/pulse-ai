-- 0052_proactive_sends.sql
--
-- One ledger for every proactive outbound Kip initiates (event follow-ups now,
-- check-ins / reports / competitor pings as they migrate over). It backs a
-- single per-brand proactive budget so three loops can't each decide to text
-- the owner "once a day" and collectively spam them into muting the number.
--
-- `channel` is which proactive behaviour sent it (event_followup, checkin, …),
-- kept so Phase 3's learning loop can attribute engagement per channel.

create table if not exists proactive_sends (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  channel    text not null,
  ref        text,                        -- optional: the event id / trigger id that caused it
  sent_at    timestamptz not null default now()
);

-- The budget query is "anything proactive for this brand since T?" — brand + time.
create index if not exists idx_proactive_sends_brand_sent
  on proactive_sends (brand_id, sent_at desc);
