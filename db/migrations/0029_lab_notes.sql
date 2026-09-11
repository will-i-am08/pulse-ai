-- 0029_lab_notes.sql — operator notes on lab replies/actions (Twilio-free agent lab).
-- Lab brands are flagged via brands.facts.lab = true (no schema change for that).

create table if not exists lab_notes (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  target_type text not null check (target_type in ('message', 'approval_log', 'post', 'onboarding')),
  target_id   text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_lab_notes_brand_created
  on lab_notes (brand_id, created_at desc);

create index if not exists idx_lab_notes_target
  on lab_notes (brand_id, target_type, target_id);
