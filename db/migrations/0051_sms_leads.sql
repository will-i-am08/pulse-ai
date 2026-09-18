-- 0051_sms_leads.sql
--
-- Marketing QR → SMS funnel. Unknown numbers that text Kip are not brands
-- (creating one would occupy unique client_phone and trip worker/onboarding
-- loops). Store the lead here, reply with a signup link, and mark converted
-- when /signup completes with the same phone.

create table if not exists sms_leads (
  phone text primary key,
  source text,
  last_body text,
  first_inbound_at timestamptz not null default now(),
  last_inbound_at timestamptz not null default now(),
  last_replied_at timestamptz,
  reply_count integer not null default 0,
  last_provider_message_id text,
  converted_at timestamptz
);

create index if not exists idx_sms_leads_open
  on sms_leads (last_inbound_at desc)
  where converted_at is null;
