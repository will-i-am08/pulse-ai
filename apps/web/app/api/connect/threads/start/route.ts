import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { authorizeUrl, threadsConfigured } from '@/lib/threads/oauth';
import { signState } from '@/lib/meta/state';

export const dynamic = 'force-dynamic';

const base = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

/** Kick off Threads authorisation for the signed-in user. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', base()));
  if (!threadsConfigured()) return NextResponse.redirect(new URL('/app?threads=unconfigured', base()));
  return NextResponse.redirect(authorizeUrl(signState(user.id)));
}
