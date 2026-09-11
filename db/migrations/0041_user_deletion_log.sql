-- 0041_user_deletion_log.sql — audit trail for operator user deletions.
--
-- Records who deactivated / deleted / restored whom, and when. Deliberately
-- carries no foreign keys and snapshots the actor + target labels as text, so
-- the log survives a hard delete of either party (the whole point of an audit
-- trail is that it outlives the row it describes).

create table if not exists user_deletion_log (
  id             uuid primary key default gen_random_uuid(),
  action         text not null check (action in ('soft_delete', 'hard_delete', 'restore')),
  actor_user_id  uuid,
  actor_label    text,
  target_user_id uuid,
  target_label   text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_user_deletion_log_created on user_deletion_log (created_at desc);
