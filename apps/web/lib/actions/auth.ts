'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query, queryOne, encrypt, decrypt, generateLoginCode, normalizePhone } from '@pulse/shared';
import { deliverPendingLoginCodes } from '@pulse/gateway';
import { createSessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

/** Kick delivery now so login doesn't wait on the worker/bot poller. */
async function flushLoginCodes(): Promise<void> {
  try {
    await deliverPendingLoginCodes();
  } catch (err) {
    console.error('issueCode: immediate login-code delivery failed; poller will retry', err);
  }
}

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

/** Queue a fresh login code for a phone, tied to the user + their brand. */
async function issueCode(
  phone: string,
  userId: string,
  brandId: string | null,
  purpose: 'login' | 'signup',
): Promise<void> {
  // Throttle: if a code was queued very recently, don't spam the channel — the
  // existing one is still valid.
  const recent = await queryOne<{ id: string }>(
    `select id from login_codes
      where phone = $1 and consumed_at is null
        and created_at > now() - ($2 || ' seconds')::interval
      order by created_at desc limit 1`,
    [phone, String(RESEND_THROTTLE_SECONDS)],
  );
  if (recent) {
    // Existing code is still valid — retry delivery in case the first attempt
    // failed (bot down, Twilio blip) without minting a second code.
    await flushLoginCodes();
    return;
  }

  const code = generateLoginCode();
  await query(
    `insert into login_codes (phone, user_id, brand_id, code_encrypted, purpose, expires_at)
     values ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [phone, userId, brandId, encrypt(code), purpose, String(CODE_TTL_MINUTES)],
  );
  await flushLoginCodes();
}

/** Step 1 of login: look up the phone, queue a code, go to the verify screen. */
export async function requestLoginCode(formData: FormData): Promise<void> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!phone) redirect('/login?error=badphone');

  const user = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (!user) redirect('/login?error=nouser');

  const brandId = await resolveBrandForPhone(user!.id, phone!);
  await issueCode(phone!, user!.id, brandId, 'login');
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

  const existingUser = await queryOne<{ id: string }>('select id from users where phone = $1', [phone]);
  if (existingUser) redirect('/login?error=exists');

  // client_phone is unique — a prior brand (often seeded before phone-auth)
  // would make the insert fail after the user row already exists, leaving an
  // account that can never receive login codes.
  const phoneTaken = await queryOne<{ id: string; owner_user_id: string | null }>(
    'select id, owner_user_id from brands where client_phone = $1',
    [phone],
  );
  if (phoneTaken) {
    // If that brand has no phone-auth owner yet, claim it instead of failing.
    if (!phoneTaken.owner_user_id) {
      const user = await queryOne<{ id: string }>(
        'insert into users (phone, email, name) values ($1, $2, $3) returning id',
        [phone, email, name],
      );
      if (!user) redirect('/signup?error=failed');
      await query(
        `update brands
            set owner_user_id = $1,
                name = coalesce(nullif(name, ''), $2),
                discord_user_id = coalesce(nullif($3, ''), discord_user_id),
                account_type = coalesce(account_type, $4),
                website = coalesce(website, nullif($5, ''))
          where id = $6`,
        [user!.id, name, discordUserId, accountType, website, phoneTaken.id],
      );
      await issueCode(phone!, user!.id, phoneTaken.id, 'signup');
      redirect(`/login/verify?phone=${encodeURIComponent(phone!)}&new=1`);
    }
    redirect('/signup?error=phoneinuse');
  }

  const user = await queryOne<{ id: string }>(
    'insert into users (phone, email, name) values ($1, $2, $3) returning id',
    [phone, email, name],
  );
  if (!user) redirect('/signup?error=failed');

  let brand: { id: string } | null = null;
  try {
    brand = await queryOne<{ id: string }>(
      `insert into brands (name, client_phone, owner_user_id, discord_user_id, account_type, website, onboarding_state)
       values ($1, $2, $3, $4, $5, $6, '{"status":"pending"}'::jsonb)
       returning id`,
      [name, phone, user!.id, discordUserId || null, accountType, website || null],
    );
  } catch {
    // Roll back the orphan user so a retry isn't stuck as "exists" with no brand.
    await query('delete from users where id = $1', [user!.id]).catch(() => undefined);
    redirect('/signup?error=failed');
  }
  if (!brand) {
    await query('delete from users where id = $1', [user!.id]).catch(() => undefined);
    redirect('/signup?error=failed');
  }

  await issueCode(phone!, user!.id, brand!.id, 'signup');
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
