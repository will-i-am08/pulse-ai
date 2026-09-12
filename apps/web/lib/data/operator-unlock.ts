import 'server-only';
import { encrypt, decrypt, generateLoginCode, query, queryOne } from '@pulse/shared';
import { deliverPendingLoginCodes } from '@pulse/gateway/login-codes';

const UNLOCK_TTL_HOURS = 1;
const CODE_QUEUE_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 5;

export type UnlockRequestResult =
  | { ok: true }
  | { ok: false; error: 'no_phone' | 'not_found' | 'throttled' };

export type UnlockVerifyResult =
  | { ok: true; expiresAt: string }
  | { ok: false; error: 'invalid' | 'expired' | 'locked' | 'not_found' | 'no_phone' };

export interface UnlockStatus {
  unlocked: boolean;
  expiresAt: string | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether this operator currently has an unlock window on the target user. */
export async function getUnlockStatus(
  operatorUserId: string,
  targetUserId: string,
): Promise<UnlockStatus> {
  const row = await queryOne<{ expires_at: string }>(
    `select expires_at from operator_unlocks
      where operator_user_id = $1 and target_user_id = $2 and expires_at > now()
      order by expires_at desc limit 1`,
    [operatorUserId, targetUserId],
  );
  return { unlocked: Boolean(row), expiresAt: row?.expires_at ?? null };
}

export async function requireUnlock(
  operatorUserId: string,
  targetUserId: string,
): Promise<boolean> {
  const status = await getUnlockStatus(operatorUserId, targetUserId);
  return status.unlocked;
}

export async function clearUnlock(operatorUserId: string, targetUserId: string): Promise<void> {
  await query(
    `update operator_unlocks set expires_at = least(expires_at, now())
      where operator_user_id = $1 and target_user_id = $2 and expires_at > now()`,
    [operatorUserId, targetUserId],
  );
}

/**
 * SMS a 6-digit unlock code to the target user's phone. Reuses login_codes
 * delivery so Twilio / agent fallback stays identical to login OTP.
 */
export async function requestOperatorUnlock(targetUserId: string): Promise<UnlockRequestResult> {
  const target = await queryOne<{ id: string; phone: string | null }>(
    `select id, phone from users where id = $1`,
    [targetUserId],
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (!target.phone) return { ok: false, error: 'no_phone' };

  const recent = await queryOne<{ id: string }>(
    `select id from login_codes
      where phone = $1 and purpose = 'operator_unlock' and consumed_at is null
        and created_at > now() - interval '30 seconds'
      order by created_at desc limit 1`,
    [target.phone],
  );
  if (recent) return { ok: false, error: 'throttled' };

  await query(
    `update login_codes
        set expires_at = least(expires_at, now())
      where phone = $1
        and purpose = 'operator_unlock'
        and consumed_at is null
        and expires_at > now()`,
    [target.phone],
  );

  const code = generateLoginCode();
  await query(
    `insert into login_codes (phone, user_id, brand_id, code_encrypted, purpose, expires_at)
     values ($1, $2, null, $3, 'operator_unlock', now() + ($4 || ' minutes')::interval)`,
    [target.phone, targetUserId, encrypt(code), String(CODE_QUEUE_TTL_MINUTES)],
  );

  await deliverPendingLoginCodes({ phone: target.phone }).catch((err) => {
    console.error('requestOperatorUnlock: delivery failed; poller will retry', err);
  });

  return { ok: true };
}

/** Verify the SMS code and open a 1-hour unlock window for this operator. */
export async function verifyOperatorUnlock(
  operatorUserId: string,
  targetUserId: string,
  rawCode: string,
): Promise<UnlockVerifyResult> {
  const target = await queryOne<{ id: string; phone: string | null }>(
    `select id, phone from users where id = $1`,
    [targetUserId],
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (!target.phone) return { ok: false, error: 'no_phone' };

  const input = rawCode.replace(/\D/g, '');
  if (input.length < 4) return { ok: false, error: 'invalid' };

  const newest = await queryOne<{
    id: string;
    code_encrypted: string;
    attempts: number;
  }>(
    `select id, code_encrypted, attempts from login_codes
      where phone = $1
        and purpose = 'operator_unlock'
        and consumed_at is null
        and expires_at > now()
      order by created_at desc limit 1`,
    [target.phone],
  );
  if (!newest) return { ok: false, error: 'expired' };
  if (newest.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'locked' };

  let expected: string;
  try {
    expected = decrypt(newest.code_encrypted);
  } catch {
    return { ok: false, error: 'invalid' };
  }

  if (!timingSafeEqual(input, expected)) {
    await query(`update login_codes set attempts = attempts + 1 where id = $1`, [newest.id]);
    return { ok: false, error: 'invalid' };
  }

  await query(`update login_codes set consumed_at = now() where id = $1`, [newest.id]);

  const row = await queryOne<{ expires_at: string }>(
    `insert into operator_unlocks (operator_user_id, target_user_id, expires_at)
     values ($1, $2, now() + ($3 || ' hours')::interval)
     returning expires_at`,
    [operatorUserId, targetUserId, String(UNLOCK_TTL_HOURS)],
  );

  return { ok: true, expiresAt: row!.expires_at };
}
