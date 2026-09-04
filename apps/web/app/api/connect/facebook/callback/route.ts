import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encrypt, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import { exchangeCodeForToken, toLongLivedUserToken, listManagedPages } from '@/lib/meta/oauth';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** Facebook redirects here with ?code=&state= (or ?error=… if the user declined). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  if (params.get('error')) {
    // User cancelled or denied a permission.
    return back('/app?connect=denied');
  }

  const userId = verifyState(params.get('state'));
  const code = params.get('code');
  if (!userId || !code) return back('/app?connect=invalid');

  // Defence-in-depth: the signed state already binds this callback to a user, but
  // also require that the browser is logged in as that same user.
  const session = await currentUser();
  if (!session || session.id !== userId) return back('/app?connect=invalid');

  const brand = await queryOne<Brand>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (!brand) return back('/app?connect=nobrand');

  try {
    const shortToken = await exchangeCodeForToken(code);
    const userToken = await toLongLivedUserToken(shortToken);

    // Keep the long-lived user token (encrypted) to derive Page tokens on select
    // and to re-derive / detect disconnects later.
    await query('update brands set platform_user_token_encrypted = $1 where id = $2', [
      encrypt(userToken),
      brand.id,
    ]);

    const pages = await listManagedPages(userToken);
    if (pages.length === 0) return back('/app?connect=nopages');

    return back('/app/connect/choose');
  } catch (err) {
    console.error('facebook callback failed', err);
    return back('/app?connect=failed');
  }
}
