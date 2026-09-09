import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { authorizeUrl, makePkce, xConfigured, X_PKCE_COOKIE } from '@/lib/x/oauth';
import { signState } from '@/lib/meta/state';

export const dynamic = 'force-dynamic';

const base = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

/** Kick off X (Twitter) OAuth 2.0 (PKCE) for the signed-in user. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', base()));
  if (!xConfigured()) return NextResponse.redirect(new URL('/app?x=unconfigured', base()));

  const { verifier, challenge } = makePkce();
  const res = NextResponse.redirect(authorizeUrl(signState(user.id), challenge));
  res.cookies.set(X_PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes to complete the dialog
  });
  return res;
}
