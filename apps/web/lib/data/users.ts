import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { User } from '@pulse/shared';

/** A user plus how many brands they own — the operator list row. */
export interface OperatorUser extends User {
  brand_count: number;
}

/** Who performed a deletion action, for the audit trail. */
export interface Actor {
  id: string;
  label: string;
}

export type DeletionAction = 'soft_delete' | 'hard_delete' | 'restore';

export interface DeletionLogEntry {
  id: string;
  action: DeletionAction;
  actor_user_id: string | null;
  actor_label: string | null;
  target_user_id: string | null;
  target_label: string | null;
  created_at: string;
}

/** Best-effort display name for a user row. */
function labelFor(u: { name?: string | null; email?: string | null; phone?: string | null; id: string }): string {
  return u.name || u.email || u.phone || u.id.slice(0, 8);
}

/**
 * All accounts for the operator console, most recent first. Includes
 * soft-deleted users (flagged by `deleted_at`) so an operator can restore them.
 */
export async function listUsersForOperator(): Promise<OperatorUser[]> {
  return query<OperatorUser>(
    `select u.id, u.email, u.phone, u.name, u.is_admin, u.created_at, u.deleted_at,
            count(b.id)::int as brand_count
       from users u
       left join brands b on b.owner_user_id = u.id
      group by u.id
      order by u.deleted_at nulls first, u.created_at desc`,
  );
}

/** Recent entries from the deletion audit trail. */
export async function listDeletionLog(limit = 20): Promise<DeletionLogEntry[]> {
  return query<DeletionLogEntry>(
    `select id, action, actor_user_id, actor_label, target_user_id, target_label, created_at
       from user_deletion_log
      order by created_at desc
      limit $1`,
    [limit],
  );
}

async function logAction(
  action: DeletionAction,
  actor: Actor,
  target: { id: string; label: string },
): Promise<void> {
  await query(
    `insert into user_deletion_log (action, actor_user_id, actor_label, target_user_id, target_label)
     values ($1, $2, $3, $4, $5)`,
    [action, actor.id, actor.label, target.id, target.label],
  );
}

/** Count of live (non-deleted) admins — used to prevent locking everyone out. */
async function liveAdminCount(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from users where is_admin = true and deleted_at is null`,
  );
  return row?.n ?? 0;
}

export type DeleteUserResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'self' | 'last_admin' | 'already_deleted' };

/**
 * Soft-delete: flag the account deactivated and pause its brands so Kip stops
 * running them. Reversible via {@link restoreUser}. Refuses to deactivate the
 * acting operator or the last live admin. Writes an audit-log entry.
 */
export async function softDeleteUser(userId: string, actor: Actor): Promise<DeleteUserResult> {
  if (userId === actor.id) return { ok: false, error: 'self' };

  const target = await queryOne<User>(
    `select id, name, email, phone, is_admin, deleted_at from users where id = $1`,
    [userId],
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (target.deleted_at) return { ok: false, error: 'already_deleted' };
  if (target.is_admin && (await liveAdminCount()) <= 1) return { ok: false, error: 'last_admin' };

  await query(`update users set deleted_at = now() where id = $1`, [userId]);
  // Stop Kip acting for a deactivated owner; archived brands stay archived.
  await query(
    `update brands set status = 'paused', updated_at = now()
      where owner_user_id = $1 and status = 'active'`,
    [userId],
  );
  await logAction('soft_delete', actor, { id: userId, label: labelFor(target) });
  return { ok: true };
}

/** Reverse a soft delete. Brands stay paused — an operator re-activates deliberately. */
export async function restoreUser(userId: string, actor: Actor): Promise<DeleteUserResult> {
  const target = await queryOne<User>(
    `select id, name, email, phone, deleted_at from users where id = $1`,
    [userId],
  );
  if (!target) return { ok: false, error: 'not_found' };

  await query(`update users set deleted_at = null where id = $1`, [userId]);
  await logAction('restore', actor, { id: userId, label: labelFor(target) });
  return { ok: true };
}

/**
 * Hard-delete: physically remove the account. Cascades through brands (and all
 * brand-scoped data) and phone_auth via existing FK `on delete cascade`.
 * Irreversible. Same lockout guards as soft delete. Writes an audit-log entry
 * (which survives the deletion by design — it carries no FK to users).
 */
export async function hardDeleteUser(userId: string, actor: Actor): Promise<DeleteUserResult> {
  if (userId === actor.id) return { ok: false, error: 'self' };

  const target = await queryOne<User>(
    `select id, name, email, phone, is_admin from users where id = $1`,
    [userId],
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (target.is_admin && (await liveAdminCount()) <= 1) return { ok: false, error: 'last_admin' };

  await query(`delete from users where id = $1`, [userId]);
  await logAction('hard_delete', actor, { id: userId, label: labelFor(target) });
  return { ok: true };
}
