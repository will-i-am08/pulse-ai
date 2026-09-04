import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import { exchangeCodeForToken, listLocations } from '@/lib/google/oauth';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** Google redirects here with ?code=&state= (or ?error=). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back('/app?google=denied');

  const userId = verifyState(params.get('state'));
  const code = params.get('code');
  if (!userId || !code) return back('/app?google=invalid');

  const session = await currentUser();
  if (!session || session.id !== userId) return back('/app?google=invalid');

  const brand = await queryOne<Brand>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (!brand) return back('/app?google=nobrand');

  try {
    const tokens = await exchangeCodeForToken(code);
    if (!tokens.refresh_token) {
      // No refresh token means Google didn't re-consent — send them back through.
      return back('/app?google=norefresh');
    }
    // Keep the tokens (refresh token is the durable one) encrypted on the brand.
    await query('update brands set google_tokens_encrypted = $1 where id = $2', [
      encryptJson({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
      brand.id,
    ]);

    const locations = await listLocations(tokens.access_token);
    if (locations.length === 0) return back('/app?google=nolocations');

    return back('/app/connect/google/choose');
  } catch (err) {
    console.error('google callback failed', err);
    return back('/app?google=failed');
  }
}
