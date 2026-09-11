-- 0030_lab_chats.sql — archive lab SMS threads so "restart onboarding"
-- starts a fresh chat with no memory, while old chats stay browsable.

create table if not exists lab_chats (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  title        text not null,
  status       text not null default 'archived'
               check (status in ('active', 'archived')),
  started_at   timestamptz not null default now(),
  archived_at  timestamptz,
  message_count int not null default 0
);

create index if not exists idx_lab_chats_brand_started
  on lab_chats (brand_id, started_at desc);

-- Snapshot of messages belonging to an archived lab chat.
create table if not exists lab_chat_messages (
  id                   uuid primary key,
  chat_id              uuid not null references lab_chats(id) on delete cascade,
  brand_id             uuid not null references brands(id) on delete cascade,
  direction            text not null check (direction in ('inbound','outbound')),
  channel              text not null default 'sms',
  body                 text,
  media_ids            uuid[] not null default '{}',
  type                 text,
  provider_message_sid text,
  created_at           timestamptz not null default now()
);

create index if not exists idx_lab_chat_messages_chat_created
  on lab_chat_messages (chat_id, created_at asc);

-- Optional pointer so notes stay associated with an archived chat.
alter table lab_notes
  add column if not exists lab_chat_id uuid references lab_chats(id) on delete set null;

create index if not exists idx_lab_notes_chat
  on lab_notes (lab_chat_id);
