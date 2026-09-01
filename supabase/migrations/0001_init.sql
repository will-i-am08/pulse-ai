-- 0001_init.sql — Pulse Texting Agent core schema
-- Single-operator, multi-brand. Service role bypasses RLS; the dashboard
-- authenticates as the one operator. Brand isolation is enforced in app code
-- via brand_id; RLS here is the backstop against the anon key.

create extension if not exists pgcrypto;

-- Shared updated_at trigger
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── brands ────────────────────────────────────────────────
create table if not exists brands (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  client_phone              text not null unique,               -- E.164, identifies inbound sender
  brand_voice_profile       jsonb not null default '{}'::jsonb, -- structured voice notes (the "learning")
  ig_user_id                text,
  fb_page_id                text,
  platform_tokens_encrypted text,                               -- AES-GCM blob, decrypted app-side only
  approver                  text not null default 'operator'
                              check (approver in ('operator','client')),
  status                    text not null default 'active'
                              check (status in ('active','paused','archived')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ─── messages ──────────────────────────────────────────────
create table if not exists messages (
  id                   uuid primary key default gen_random_uuid(),
  brand_id             uuid not null references brands(id) on delete cascade,
  direction            text not null check (direction in ('inbound','outbound')),
  channel              text not null default 'sms',
  body                 text,
  media_ids            uuid[] not null default '{}',
  type                 text check (type in ('media','instruction','approval','question','other')),
  provider_message_sid text,
  created_at           timestamptz not null default now()
);

-- ─── media_assets ──────────────────────────────────────────
create table if not exists media_assets (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  storage_path     text not null,                    -- Supabase Storage object path, per-brand prefix
  kind             text not null check (kind in ('photo','video')),
  source           text not null check (source in ('client','operator')),
  content_type     text,
  used_in_post_id  uuid,                             -- soft link; FK added after posts exists
  created_at       timestamptz not null default now()
);

-- ─── posts ─────────────────────────────────────────────────
create table if not exists posts (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  caption          text,
  media_ids        uuid[] not null default '{}',
  platform         text not null check (platform in ('instagram','facebook')),
  status           text not null default 'draft'
                     check (status in ('draft','pending_approval','approved','scheduled','publishing','published','failed','rejected')),
  scheduled_at     timestamptz,
  published_at     timestamptz,
  external_post_id text,                             -- IG/FB media id once live
  engagement       jsonb not null default '{}'::jsonb,
  retry_count      int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table media_assets
  add constraint media_assets_used_in_post_fk
  foreign key (used_in_post_id) references posts(id) on delete set null;

-- ─── strategy_notes (one per brand) ────────────────────────
create table if not exists strategy_notes (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null unique references brands(id) on delete cascade,
  voice_notes     text,
  posting_cadence text,
  best_times      jsonb not null default '{}'::jsonb,
  content_mix     jsonb not null default '{}'::jsonb,
  last_updated    timestamptz not null default now()
);

-- ─── proactive_triggers ────────────────────────────────────
create table if not exists proactive_triggers (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  kind         text not null check (kind in ('checkin','report','reminder','alert')),
  schedule     text not null,                        -- cron expression
  template_id  text,                                 -- WhatsApp template id later; null on SMS
  enabled      boolean not null default true,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── approval_log (audit trail — non-functional requirement) ─
create table if not exists approval_log (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references posts(id) on delete set null,
  brand_id   uuid not null references brands(id) on delete cascade,
  action     text not null check (action in
               ('draft_created','approved','edited','rejected','scheduled','published','publish_failed','send_failed')),
  actor      text,                                   -- 'operator' | 'client' | 'system'
  before     jsonb,
  after      jsonb,
  note       text,
  created_at timestamptz not null default now()
);

-- ─── corrections (before/after pairs — the learning mechanism) ─
create table if not exists corrections (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  post_id        uuid references posts(id) on delete set null,
  before_caption text,
  after_caption  text,
  created_at     timestamptz not null default now()
);

-- ─── triggers ──────────────────────────────────────────────
drop trigger if exists brands_set_updated_at on brands;
create trigger brands_set_updated_at before update on brands
  for each row execute function set_updated_at();

drop trigger if exists posts_set_updated_at on posts;
create trigger posts_set_updated_at before update on posts
  for each row execute function set_updated_at();

-- ─── indexes ───────────────────────────────────────────────
create index if not exists idx_messages_brand_created on messages (brand_id, created_at desc);
create index if not exists idx_posts_brand_status on posts (brand_id, status);
create index if not exists idx_posts_due on posts (status, scheduled_at)
  where status in ('approved','scheduled');
create index if not exists idx_media_brand on media_assets (brand_id);
create index if not exists idx_triggers_brand_kind on proactive_triggers (brand_id, kind);
create index if not exists idx_approval_brand_created on approval_log (brand_id, created_at desc);
create index if not exists idx_corrections_brand_created on corrections (brand_id, created_at desc);

-- ─── row level security ────────────────────────────────────
-- Single operator: authenticated role gets full access; service role bypasses RLS entirely.
do $$
declare t text;
begin
  foreach t in array array[
    'brands','messages','media_assets','posts','strategy_notes',
    'proactive_triggers','approval_log','corrections'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_operator_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true);',
      t || '_operator_all', t
    );
  end loop;
end $$;
