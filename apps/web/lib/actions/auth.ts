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
import { createSessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const CODE_TTL_MINUTES = 10;
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

/** Queue a fresh login code for a phone, tied to the user + their brand. */
async function issueCode(
  phone: string,
  userId: string,
  brandId: string | null,
  purpose: 'login' | 'signup',
  exec: Executor = poolExecutor,
): Promise<void> {
  // Throttle: if a code was queued very recently, don't spam the channel — the
  // existing one is still valid.
  const recent = await exec.queryOne<{ id: string }>(
    `select id from login_codes
      where phone = $1 and consumed_at is null
        and created_at > now() - ($2 || ' seconds')::interval
      order by created_at desc limit 1`,
    [phone, String(RESEND_THROTTLE_SECONDS)],
  );
  if (recent) return;

  const code = generateLoginCode();
  await exec.query(
    `insert into login_codes (phone, user_id, brand_id, code_encrypted, purpose, expires_at)
     values ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [phone, userId, brandId, encrypt(code), purpose, String(CODE_TTL_MINUTES)],
  );
}

/** Step 1 of login: look up the phone, queue a code, go to the verify screen. */
export async function requestLoginCode(formData: FormData): Promise<void> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!phone) redirect('/login?error=badphone');

  const user = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (!user) redirect('/login?error=nouser');

  const brand = await queryOne<{ id: string }>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user!.id],
  );
  await issueCode(phone!, user!.id, brand?.id ?? null, 'login');
  redirect(`/login/verify?phone=${encodeURIComponent(phone!)}`);
}

/** Step 2 of login: verify the code and start the session. */
export async function verifyLoginCode(formData: FormData): Promise<void> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  const input = String(formData.get('code') ?? '').replace(/\D/g, '');
  if (!phone) redirect('/login?error=badphone');
  const verifyUrl = `/login/verify?phone=${encodeURIComponent(phone!)}`;

  const row = await queryOne<{ id: string; user_id: string | null; code_encrypted: string; attempts: number }>(
    `select id, user_id, code_encrypted, attempts from login_codes
      where phone = $1 and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [phone],
  );
  if (!row) redirect(`${verifyUrl}&error=expired`);
  if (row!.attempts >= MAX_ATTEMPTS) redirect(`${verifyUrl}&error=locked`);

  let actual = '';
  try {
    actual = decrypt(row!.code_encrypted);
  } catch {
    redirect(`${verifyUrl}&error=expired`);
  }

  if (!input || !timingSafeEqual(input, actual)) {
    await query('update login_codes set attempts = attempts + 1 where id = $1', [row!.id]);
    redirect(`${verifyUrl}&error=wrong`);
  }
  if (!row!.user_id) redirect('/login?error=nouser');

  await query('update login_codes set consumed_at = now() where id = $1', [row!.id]);
  await setSession(row!.user_id!);
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

  const existing = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (existing) redirect('/login?error=exists');

  // Atomic: the user, their brand, and the first login code all commit together
  // or not at all. If anything throws (e.g. a misconfigured encryption key, or a
  // race on the unique phone index), the whole thing rolls back — no orphaned
  // user/brand rows left behind to block a genuine retry.
  try {
    await withTransaction(async (tx) => {
      const user = await tx.queryOne<{ id: string }>(
        'insert into users (phone, email, name) values ($1, $2, $3) returning id',
        [phone, email, name],
      );
      if (!user) throw new Error('user insert returned no row');

      const brand = await tx.queryOne<{ id: string }>(
        `insert into brands (name, client_phone, owner_user_id, discord_user_id, account_type, website, onboarding_state)
         values ($1, $2, $3, $4, $5, $6, '{"status":"pending"}'::jsonb)
         returning id`,
        [name, phone, user.id, discordUserId || null, accountType, website || null],
      );

      await issueCode(phone!, user.id, brand?.id ?? null, 'signup', tx);
    });
  } catch (err) {
    console.error('[signup] failed:', err instanceof Error ? err.message : err);
    redirect('/signup?error=failed');
  }

  redirect(`/login/verify?phone=${encodeURIComponent(phone!)}&new=1`);
}

/**
 * Operator break-glass: if the messaging channel is down, the admin can still
 * sign in with OPERATOR_PASSWORD. Never exposed to normal users.
 */
export async function operatorLoginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected || !password || !timingSafeEqual(password, expected)) {
    redirect('/login?error=operator');
  }
  const admin = await queryOne<{ id: string }>(
    'select id from users where is_admin = true order by created_at asc limit 1',
  );
  if (!admin) redirect('/login?error=noadmin');
  await setSession(admin!.id);
  redirect('/app');
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}
