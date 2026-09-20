import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';

// Only the operator console under /app requires a session. The marketing
// landing (/), privacy, login, and the public webhook + media routes are open.
function isProtectedPath(pathname: string): boolean {
  return (
    pathname === '/app' ||
    pathname.startsWith('/app/') ||
    pathname === '/lab' ||
    pathname.startsWith('/lab/') ||
    pathname === '/payment' ||
    pathname.startsWith('/payment/')
  );
}

function nextWithPathname(request: NextRequest, pathname: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedPath = isProtectedPath(pathname);

  // Read directly from process.env (not @pulse/shared's getServerEnv) — this
  // file runs on the Edge runtime and must not bundle `pg`.
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    // Never throw from middleware — on Vercel that surfaces as a bare
    // MIDDLEWARE_INVOCATION_FAILED / opaque 404-ish failure for /lab.
    // Unauthenticated redirect keeps the lab reachable once AUTH_SECRET is set.
    if (!protectedPath) return nextWithPathname(request, pathname);
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = (await verifySessionValue(cookieValue, authSecret)) !== null;

  if (protectedPath && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  if (authed && pathname === '/login') {
    const raw = request.nextUrl.searchParams.get('redirectTo');
    const next =
      raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')
        ? raw
        : '/app';
    const url = request.nextUrl.clone();
    url.pathname = next;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return nextWithPathname(request, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
