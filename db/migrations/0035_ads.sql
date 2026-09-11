-- 0035_ads.sql — Phase F: Meta paid advertising.
-- Ad account connect, feature flag, campaigns, approvals, spend logs.

alter table brands add column if not exists features jsonb not null default '{
  "autopilot": true,
  "auto_replies": true,
  "lead_handoff": true,
  "ads": false,
  "ads_autopilot": false
}'::jsonb;

alter table brands add column if not exists ad_account_id text;
alter table brands add column if not exists ad_account_name text;
alter table brands add column if not exists ads_tokens_encrypted text;
alter table brands add column if not exists ads_connected_at timestamptz;
alter table brands add column if not exists ads_spend_caps jsonb not null default '{
  "weekly_cents": 50000,
  "campaign_cents": 20000
}'::jsonb;

-- Paid Meta campaigns (distinct from organic `campaigns`).
create table if not exists ad_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references brands(id) on delete cascade,
  name                text not null,
  objective           text not null
                        check (objective in ('awareness','traffic','leads','messages','sales')),
  status              text not null default 'proposed'
                        check (status in ('proposed','preview','active','paused','done','cancelled','killed')),
  audience            jsonb not null default '{}'::jsonb,
  offer_ref           jsonb not null default '{}'::jsonb,
  creative            jsonb not null default '{}'::jsonb,
  budget_cents        integer not null default 0,
  duration_days       integer not null default 7,
  weekly_cap_cents    integer,
  campaign_cap_cents  integer,
  external_campaign_id text,
  external_adset_id   text,
  external_ad_id      text,
  source_post_id      uuid references posts(id) on delete set null,
  kind                text not null default 'campaign'
                        check (kind in ('campaign','boost')),
  metrics             jsonb not null default '{}'::jsonb,
  plan                jsonb not null default '{}'::jsonb,
  starts_at           timestamptz,
  ends_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ad_campaigns_brand_status
  on ad_campaigns (brand_id, status);

create index if not exists idx_ad_campaigns_brand_created
  on ad_campaigns (brand_id, created_at desc);

-- Explicit spend / launch / budget-change approvals (audit trail).
create table if not exists ad_approvals (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  ad_campaign_id  uuid references ad_campaigns(id) on delete set null,
  action          text not null
                    check (action in (
                      'launch','boost','pause','resume','kill',
                      'budget_edit','scale','enable_ads','connect',
                      'cap_breach','reject'
                    )),
  actor           text not null default 'owner',
  before          jsonb,
  after           jsonb,
  note            text,
  message_id      uuid references messages(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ad_approvals_brand_created
  on ad_approvals (brand_id, created_at desc);

-- Spend ledger for cap enforcement (mock + live).
create table if not exists ad_spend_logs (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  ad_campaign_id  uuid references ad_campaigns(id) on delete set null,
  amount_cents    integer not null,
  currency        text not null default 'USD',
  source          text not null default 'sync'
                    check (source in ('sync','mock','manual','estimate')),
  occurred_at     timestamptz not null default now(),
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ad_spend_logs_brand_occurred
  on ad_spend_logs (brand_id, occurred_at desc);

create index if not exists idx_ad_spend_logs_campaign
  on ad_spend_logs (ad_campaign_id, occurred_at desc);

drop trigger if exists ad_campaigns_set_updated_at on ad_campaigns;
create trigger ad_campaigns_set_updated_at before update on ad_campaigns
  for each row execute function set_updated_at();
