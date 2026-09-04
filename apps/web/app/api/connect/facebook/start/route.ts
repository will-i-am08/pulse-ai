import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { loginDialogUrl } from '@/lib/meta/oauth';
import { signState } from '@/lib/meta/state';

export const dynamic = 'force-dynamic';

/** Kick off Facebook Login for the signed-in user. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', process.env.APP_BASE_URL ?? 'http://localhost:3000'));
  return NextResponse.redirect(loginDialogUrl(signState(user.id)));
}
