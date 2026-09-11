-- 0040_user_soft_delete.sql — reversible user deactivation for the operator console.
--
-- `deleted_at` marks a user as deactivated without removing the row: their
-- session dies (currentUser filters them out), login is refused, and their
-- brands are paused so Kip stops running them — but the audit trail survives
-- and an operator can restore them. Hard deletion still exists for genuine
-- erasure and cascades through brands via the existing FK.

alter table users add column if not exists deleted_at timestamptz;

create index if not exists idx_users_deleted_at on users (deleted_at);
