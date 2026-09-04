import { NextResponse, type NextRequest } from 'next/server';
import { queryOne, encryptJson, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import { exchangeSourceCode, SOURCE_TOKEN_COOKIE } from '@/lib/google/sources';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** Google redirects here with ?code=&state= (or ?error=) after Photos/Drive consent. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back('/app?source=denied');

  const userId = verifyState(params.get('state'));
  const code = params.get('code');
  if (!userId || !code) return back('/app?source=invalid');

  const session = await currentUser();
  if (!session || session.id !== userId) return back('/app?source=invalid');

  const brand = await queryOne<Brand>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (!brand) return back('/app?source=nobrand');

  try {
    const tokens = await exchangeSourceCode(code);
    if (!tokens.refresh_token) return back('/app?source=norefresh');

    const res = back('/app/connect/source/choose');
    res.cookies.set(SOURCE_TOKEN_COOKIE, encryptJson({ refresh_token: tokens.refresh_token }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60, // 10 minutes to pick an album/folder
    });
    return res;
  } catch (err) {
    console.error('source callback failed', err);
    return back('/app?source=failed');
  }
}
