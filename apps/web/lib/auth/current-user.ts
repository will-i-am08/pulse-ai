import 'server-only';
import { cookies } from 'next/headers';
import { query, type User } from '@pulse/shared';
import { SESSION_COOKIE_NAME, verifySessionValue } from './session';

/** The signed-in user (server components + actions), or null. */
export async function currentUser(): Promise<User | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = await verifySessionValue(value, secret);
  if (!userId) return null;
  const rows = await query<User>(
    'select id, email, name, is_admin, created_at from users where id = $1',
    [userId],
  );
  return rows[0] ?? null;
}
