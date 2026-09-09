import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import { exchangeCode, getMe, X_PKCE_COOKIE } from '@/lib/x/oauth';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** X redirects here with ?code=&state= (or ?error=). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back('/app?x=denied');

  const userId = verifyState(params.get('state'));
  const code = params.get('code');
  if (!userId || !code) return back('/app?x=invalid');

  const session = await currentUser();
  if (!session || session.id !== userId) return back('/app?x=invalid');

  const verifier = request.cookies.get(X_PKCE_COOKIE)?.value;
  if (!verifier) return back('/app?x=expired');

  const brand = await queryOne<Brand>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (!brand) return back('/app?x=nobrand');

  try {
    const tokens = await exchangeCode(code, verifier);
    if (!tokens.refresh_token) return back('/app?x=norefresh');
    const me = await getMe(tokens.access_token);
    const expiresAt = Date.now() + (tokens.expires_in ?? 7200) * 1000;
    await query('update brands set x_user_id = $1, x_username = $2, x_tokens_encrypted = $3 where id = $4', [
      me.id,
      me.username,
      encryptJson({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: expiresAt }),
      brand.id,
    ]);
    const res = back('/app?x=success');
    res.cookies.delete(X_PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error('x callback failed', err);
    return back('/app?x=failed');
  }
}
