-- Ephemeral public demo sessions (website → sample Kip posts).
create table if not exists demo_sessions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  url         text not null,
  brand_name  text,
  summary     text,
  look_pack   text,
  samples     jsonb not null default '[]'::jsonb,
  creator_ip  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists demo_sessions_expires_idx on demo_sessions (expires_at);
create index if not exists demo_sessions_ip_created_idx on demo_sessions (creator_ip, created_at);
