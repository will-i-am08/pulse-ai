'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query, queryOne, hashPassword, verifyPassword } from '@pulse/shared';
import { createSessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

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

/** Create an account + the user's brand (pending onboarding), then sign them in. */
export async function signupAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const accountType = String(formData.get('account_type') ?? 'business') === 'personal' ? 'personal' : 'business';
  const website = String(formData.get('website') ?? '').trim();
  const discordUserId = String(formData.get('discord_user_id') ?? '').trim();

  if (!email || !password || !name) redirect('/signup?error=missing');
  if (password.length < 8) redirect('/signup?error=short');

  const existing = await queryOne('select id from users where email = $1', [email]);
  if (existing) redirect('/signup?error=exists');

  const user = await queryOne<{ id: string }>(
    'insert into users (email, password_hash, name) values ($1, $2, $3) returning id',
    [email, hashPassword(password), name],
  );
  if (!user) redirect('/signup?error=failed');

  await query(
    `insert into brands (name, client_phone, owner_user_id, discord_user_id, account_type, website, onboarding_state)
     values ($1, $2, $3, $4, $5, $6, '{"status":"pending"}'::jsonb)`,
    [name, `signup:${user!.id}`, user!.id, discordUserId || null, accountType, website || null],
  );

  await setSession(user!.id);
  redirect('/app');
}

/** Email + password sign-in. */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  const user = await queryOne<{ id: string; password_hash: string }>(
    'select id, password_hash from users where email = $1',
    [email],
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    redirect('/login?error=1');
  }

  await setSession(user!.id);
  redirect('/app');
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}
