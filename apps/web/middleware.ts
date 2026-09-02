import { NextResponse, type NextRequest } from 'next/server';
import { isValidSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/session';

// Operator-only console. Guard everything except the inbound webhook (Twilio
// must be able to POST unauthenticated), the public media route (Meta fetches
// image_url when publishing — no session), the privacy page (Meta App Review
// needs to reach it without a session), and the login page itself.
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/media/') ||
    pathname === '/privacy' ||
    pathname === '/login'
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  // Read directly from process.env (not @pulse/shared's getServerEnv) — this
  // file runs on the Edge runtime and must not bundle `pg`.
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    // Misconfigured deploy — fail open only for routes that must always work,
    // fail closed everywhere else.
    if (isPublic) return NextResponse.next();
    throw new Error('AUTH_SECRET is not set');
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await isValidSessionCookie(cookieValue, authSecret);

  if (!authed && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  if (authed && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
