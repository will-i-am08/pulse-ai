import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { googleConfigured } from '@/lib/google/oauth';
import { sourceLoginUrl } from '@/lib/google/sources';
import { signState } from '@/lib/meta/state';

export const dynamic = 'force-dynamic';

const base = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

/** Kick off Google Photos/Drive authorisation so the agent can auto-pull media. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', base()));
  if (!googleConfigured()) return NextResponse.redirect(new URL('/app?source=unconfigured', base()));
  return NextResponse.redirect(sourceLoginUrl(signState(user.id)));
}
