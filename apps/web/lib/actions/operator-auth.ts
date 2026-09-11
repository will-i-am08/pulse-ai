'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { queryOne } from '@pulse/shared';
import { createSessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

/**
 * Operator login lives in its own server-action module so it never pulls
 * `@pulse/gateway` (and thus orchestrator → satori/harfbuzz WASM). A top-level
 * gateway import in the shared auth actions aborted login on Vercel with
 * ENOENT hb.wasm, so the session cookie never stuck and middleware bounced
 * back to /login.
 */

/** Constant-time string compare (avoids leaking length-independent timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Same-origin path only — blocks open redirects. */
function safeAppPath(raw: FormDataEntryValue | null, fallback: string): string {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}

function operatorLoginErrorUrl(formData: FormData, error: 'operator' | 'noadmin'): string {
  const next = safeAppPath(formData.get('redirectTo'), '/lab');
  const params = new URLSearchParams({ error, redirectTo: next });
  return `/login?${params.toString()}`;
}

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

/**
 * Operator break-glass: if the messaging channel is down, the admin can still
 * sign in with OPERATOR_PASSWORD. Never exposed to normal users.
 * Lands in the agent lab by default (or ?redirectTo= when safe).
 */
export async function operatorLoginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected || !password || !timingSafeEqual(password, expected)) {
    redirect(operatorLoginErrorUrl(formData, 'operator'));
  }
  const admin = await queryOne<{ id: string }>(
    'select id from users where is_admin = true order by created_at asc limit 1',
  );
  if (!admin) redirect(operatorLoginErrorUrl(formData, 'noadmin'));
  await setSession(admin.id);
  redirect(safeAppPath(formData.get('redirectTo'), '/lab'));
}
