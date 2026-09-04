import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { loginUrl, googleConfigured } from '@/lib/google/oauth';
import { signState } from '@/lib/meta/state';

export const dynamic = 'force-dynamic';

const base = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

/** Kick off Google Business Profile authorisation for the signed-in user. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', base()));
  if (!googleConfigured()) return NextResponse.redirect(new URL('/app?google=unconfigured', base()));
  return NextResponse.redirect(loginUrl(signState(user.id)));
}
