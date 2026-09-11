-- 0038_crm_webhook.sql — Phase I: thin CRM webhook + lead polish.
-- Owner catch-hook URL (encrypted at rest), push audit log, optional interaction permalink.

alter table brands add column if not exists crm_webhook_url text;

alter table interactions add column if not exists permalink text;

create table if not exists crm_push_log (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  interaction_id  uuid references interactions(id) on delete set null,
  trigger         text not null
                    check (trigger in ('auto_lead', 'owner_sms', 'email_fallback')),
  status          text not null
                    check (status in ('success', 'failure', 'skipped')),
  http_status     integer,
  error           text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_crm_push_log_brand_created
  on crm_push_log (brand_id, created_at desc);

create index if not exists idx_crm_push_log_interaction
  on crm_push_log (interaction_id);
