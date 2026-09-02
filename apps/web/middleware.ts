import { NextResponse, type NextRequest } from 'next/server';
import { isValidSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/session';

// Only the operator console under /app requires a session. The marketing
// landing (/), privacy, login, and the public webhook + media routes are open.
function isProtectedPath(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedPath = isProtectedPath(pathname);

  // Read directly from process.env (not @pulse/shared's getServerEnv) — this
  // file runs on the Edge runtime and must not bundle `pg`.
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    if (!protectedPath) return NextResponse.next();
    throw new Error('AUTH_SECRET is not set');
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await isValidSessionCookie(cookieValue, authSecret);

  if (protectedPath && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  if (authed && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
