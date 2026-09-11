'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  query,
  queryOne,
  withTransaction,
  poolExecutor,
  encrypt,
  decrypt,
  generateLoginCode,
  normalizePhone,
  type Executor,
} from '@pulse/shared';
// Subpath import — avoid pulling @pulse/gateway's orchestrator re-exports
// (satori/harfbuzz) into the login serverless bundle.
import { deliverPendingLoginCodes } from '@pulse/gateway/login-codes';
import { createSessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

/**
 * Kick delivery for this phone now so login doesn't wait on the worker poller.
 * Scoped to one phone so a backlog of undeliverable codes can't stall the form.
 */
async function flushLoginCodes(phone: string): Promise<boolean> {
  try {
    const sent = await deliverPendingLoginCodes({ phone });
    return sent > 0;
  } catch (err) {
    console.error('issueCode: immediate login-code delivery failed; poller will retry', err);
    return false;
  }
}

/** How long a code stays valid after it is successfully texted (kept in sync with LOGIN_CODE_TTL_MINUTES in @pulse/gateway). */
const CODE_TTL_MINUTES = 15;
/** Upper bound while a code is still queued / undelivered (covers slow SMS). */
const CODE_QUEUE_TTL_MINUTES = Math.max(30, CODE_TTL_MINUTES * 2);
const RESEND_THROTTLE_SECONDS = 30;
const MAX_ATTEMPTS = 5;

async function setSession(userId: string): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  const value = await createSessionValue(userId, secret);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Constant-time string compare (avoids leaking length-independent timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Brand that should receive this user's login code.
 * Prefer a brand they own; fall back to the brand whose client_phone matches
 * (legacy brands created before phone-auth users, or signup that couldn't
 * insert a second brand for a phone that was already taken).
 */
async function resolveBrandForPhone(userId: string, phone: string): Promise<string | null> {
  const owned = await queryOne<{ id: string }>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (owned) return owned.id;

  const byPhone = await queryOne<{ id: string }>(
    'select id from brands where client_phone = $1 order by created_at asc limit 1',
    [phone],
  );
  if (byPhone) {
    // Heal ownership so the next login / dashboard lookup is consistent.
    await query(
      `update brands set owner_user_id = $1
        where id = $2 and (owner_user_id is null or owner_user_id <> $1)`,
      [userId, byPhone.id],
    ).catch(() => undefined);
    return byPhone.id;
  }
  return null;
}

/**
 * Queue a fresh login code for a phone, tied to the user + their brand.
 * Returns whether the code was handed to the messaging provider successfully.
 * Inside a transaction, delivery is deferred to the caller (row not visible yet).
 */
async function issueCode(
  phone: string,
  userId: string,
  brandId: string | null,
  purpose: 'login' | 'signup',
  exec: Executor = poolExecutor,
): Promise<boolean> {
  // When running inside a transaction the row isn't committed yet, so an
  // immediate flush (which reads the pool on another connection) wouldn't see
  // it. The caller flushes after commit instead — see signupAction.
  const inTransaction = exec !== poolExecutor;

  // Throttle: if a code was queued very recently, don't spam the channel — the
  // existing one is still valid.
  const recent = await exec.queryOne<{ id: string; delivered_at: string | null }>(
    `select id, delivered_at from login_codes
      where phone = $1 and consumed_at is null
        and created_at > now() - ($2 || ' seconds')::interval
      order by created_at desc limit 1`,
    [phone, String(RESEND_THROTTLE_SECONDS)],
  );
  if (recent) {
    // Existing code is still valid — retry delivery in case the first attempt
    // failed (bot down, Twilio blip) without minting a second code.
    if (inTransaction) return false;
    if (recent.delivered_at) return true;
    return flushLoginCodes(phone);
  }

  // Retire any older outstanding codes so a late SMS for a prior attempt can't
  // race with the one we're about to send (and so verify always has one winner).
  await exec.query(
    `update login_codes
        set expires_at = least(expires_at, now())
      where phone = $1
        and consumed_at is null
        and expires_at > now()`,
    [phone],
  );

  const code = generateLoginCode();
  // Queue TTL is intentionally longer than the post-delivery window: if SMS is
  // slow, the row must still be alive when delivery finally succeeds (which
  // then resets expires_at — see deliverPendingLoginCodes).
  await exec.query(
    `insert into login_codes (phone, user_id, brand_id, code_encrypted, purpose, expires_at)
     values ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [phone, userId, brandId, encrypt(code), purpose, String(CODE_QUEUE_TTL_MINUTES)],
  );
  if (inTransaction) return false;
  return flushLoginCodes(phone);
}

function verifyRedirect(phone: string, opts?: { new?: boolean; delivered?: boolean }): never {
  const params = new URLSearchParams({ phone });
  if (opts?.new) params.set('new', '1');
  if (opts?.delivered === false) params.set('warn', 'undelivered');
  redirect(`/login/verify?${params.toString()}`);
}

/** Step 1 of login: look up the phone, queue a code, go to the verify screen. */
export async function requestLoginCode(formData: FormData): Promise<void> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!phone) redirect('/login?error=badphone');

  const user = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (!user) redirect('/login?error=nouser');

  const brandId = await resolveBrandForPhone(user!.id, phone!);
  const delivered = await issueCode(phone!, user!.id, brandId, 'login');
  verifyRedirect(phone!, { delivered });
}

/** Step 2 of login: verify the code and start the session. */
export async function verifyLoginCode(formData: FormData): Promise<void> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  const input = String(formData.get('code') ?? '').replace(/\D/g, '');
  if (!phone) redirect('/login?error=badphone');
  const verifyUrl = `/login/verify?phone=${encodeURIComponent(phone!)}`;

  // Prefer the newest code, but accept any still-valid one for this phone so a
  // slightly older SMS still works if a resend raced mid-delivery.
  const rows = await query<{ id: string; user_id: string | null; code_encrypted: string; attempts: number }>(
    `select id, user_id, code_encrypted, attempts from login_codes
      where phone = $1 and consumed_at is null and expires_at > now()
      order by created_at desc
      limit 5`,
    [phone],
  );
  if (rows.length === 0) redirect(`${verifyUrl}&error=expired`);

  const locked = rows.every((r) => r.attempts >= MAX_ATTEMPTS);
  if (locked) redirect(`${verifyUrl}&error=locked`);

  let matched: (typeof rows)[number] | null = null;
  for (const row of rows) {
    if (row.attempts >= MAX_ATTEMPTS) continue;
    let actual = '';
    try {
      actual = decrypt(row.code_encrypted);
    } catch {
      continue;
    }
    if (input && timingSafeEqual(input, actual)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    // Count the attempt against the newest unlocked row.
    const newest = rows.find((r) => r.attempts < MAX_ATTEMPTS) ?? rows[0]!;
    await query('update login_codes set attempts = attempts + 1 where id = $1', [newest.id]);
    redirect(`${verifyUrl}&error=wrong`);
  }
  if (!matched!.user_id) redirect('/login?error=nouser');

  await query('update login_codes set consumed_at = now() where id = $1', [matched!.id]);
  await setSession(matched!.user_id!);
  redirect('/app');
}

/** Create an account (phone identity, no password) + their brand, then verify. */
export async function signupAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  const emailRaw = String(formData.get('email') ?? '').trim().toLowerCase();
  const email = emailRaw || null;
  const accountType = String(formData.get('account_type') ?? 'business') === 'personal' ? 'personal' : 'business';
  const website = String(formData.get('website') ?? '').trim();
  const discordUserId = String(formData.get('discord_user_id') ?? '').trim();

  if (!name) redirect('/signup?error=missing');
  if (!phone) redirect('/signup?error=badphone');

  const existingUser = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (existingUser) redirect('/login?error=exists');

  // client_phone is unique — a prior brand (often seeded before phone-auth)
  // would make a fresh insert fail after the user row already exists. If that
  // brand has no phone-auth owner yet, we claim it; if it's already owned, the
  // phone genuinely belongs to another account.
  const phoneTaken = await queryOne<{ id: string; owner_user_id: string | null }>(
    'select id, owner_user_id from brands where client_phone = $1',
    [phone],
  );
  if (phoneTaken?.owner_user_id) redirect('/signup?error=phoneinuse');

  // Atomic: the user, their brand (new or claimed), and the first login code all
  // commit together or not at all. If anything throws (e.g. a misconfigured
  // encryption key, or a race on the unique phone index), the whole thing rolls
  // back — no orphaned user/brand rows left behind to block a genuine retry.
  try {
    await withTransaction(async (tx) => {
      const user = await tx.queryOne<{ id: string }>(
        'insert into users (phone, email, name) values ($1, $2, $3) returning id',
        [phone, email, name],
      );
      if (!user) throw new Error('user insert returned no row');

      let brandId: string | null;
      if (phoneTaken) {
        // Claim the pre-existing unowned brand rather than inserting a duplicate.
        await tx.query(
          `update brands
              set owner_user_id = $1,
                  name = coalesce(nullif(name, ''), $2),
                  discord_user_id = coalesce(nullif($3, ''), discord_user_id),
                  account_type = coalesce(account_type, $4),
                  website = coalesce(website, nullif($5, ''))
            where id = $6`,
          [user.id, name, discordUserId, accountType, website, phoneTaken.id],
        );
        brandId = phoneTaken.id;
      } else {
        const brand = await tx.queryOne<{ id: string }>(
          `insert into brands (name, client_phone, owner_user_id, discord_user_id, account_type, website, onboarding_state)
           values ($1, $2, $3, $4, $5, $6, '{"status":"pending"}'::jsonb)
           returning id`,
          [name, phone, user.id, discordUserId || null, accountType, website || null],
        );
        brandId = brand?.id ?? null;
      }

      await issueCode(phone!, user.id, brandId, 'signup', tx);
    });
  } catch (err) {
    console.error('[signup] failed:', err instanceof Error ? err.message : err);
    redirect('/signup?error=failed');
  }

  // The code is committed now — kick immediate delivery so the user doesn't wait
  // on the poller. issueCode skips this while inside the transaction above.
  const delivered = await flushLoginCodes(phone!);
  verifyRedirect(phone!, { new: true, delivered });
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}
