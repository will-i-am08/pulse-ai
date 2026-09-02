'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerEnv } from '@pulse/shared';
import { sessionCookieValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
}

/** Password form → compare to OPERATOR_PASSWORD → set the signed session cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const redirectTo = safeRedirectTarget(formData.get('redirectTo'));

  const env = getServerEnv();
  if (!env.OPERATOR_PASSWORD || !env.AUTH_SECRET) {
    throw new Error('loginAction: OPERATOR_PASSWORD / AUTH_SECRET are not configured');
  }

  if (password !== env.OPERATOR_PASSWORD) {
    redirect(`/login?error=1&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const value = await sessionCookieValue(env.AUTH_SECRET);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect(redirectTo);
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}
