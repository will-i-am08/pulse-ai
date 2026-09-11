import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encrypt, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import {
  exchangeCodeForToken,
  toLongLivedUserToken,
  listManagedPages,
  listAdAccounts,
} from '@/lib/meta/oauth';
import { verifySmsOauthState, mintSmsConnectToken } from '@/lib/sms-connect/token';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** Facebook redirects here with ?code=&state= (or ?error=… if the user declined). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get('state');
  const sms = verifySmsOauthState(state);

  if (params.get('error')) {
    return sms.ok ? back('/c/done?status=denied') : back('/app?connect=denied');
  }

  const code = params.get('code');
  if (!code) {
    return sms.ok ? back('/c/done?status=invalid') : back('/app?connect=invalid');
  }

  // ── SMS deep-link flow (no dashboard session required) ───────────────────
  if (sms.ok) {
    const brand = await queryOne<Brand>('select * from brands where id = $1', [sms.brandId]);
    if (!brand) return back('/c/done?status=nobrand');

    try {
      const shortToken = await exchangeCodeForToken(code);
      const userToken = await toLongLivedUserToken(shortToken);

      // Ads purpose → pick an ad account (not a Page).
      if (sms.purpose === 'ads') {
        await query('update brands set platform_user_token_encrypted = $1 where id = $2', [
          encrypt(userToken),
          brand.id,
        ]);
        const accounts = await listAdAccounts(userToken);
        if (accounts.length === 0) return back('/c/done?status=nopages');
        const pickToken = mintSmsConnectToken(brand.id, 'ads');
        return back(`/c/choose-ads?t=${encodeURIComponent(pickToken)}`);
      }

      await query('update brands set platform_user_token_encrypted = $1 where id = $2', [
        encrypt(userToken),
        brand.id,
      ]);

      const pages = await listManagedPages(userToken);
      if (pages.length === 0) return back('/c/done?status=nopages');

      const pickToken = mintSmsConnectToken(brand.id, 'meta');
      return back(`/c/choose?t=${encodeURIComponent(pickToken)}`);
    } catch (err) {
      console.error('facebook SMS callback failed', err);
      return back('/c/done?status=failed');
    }
  }

  // ── Dashboard session flow ───────────────────────────────────────────────
  const userId = verifyState(state);
  if (!userId) return back('/app?connect=invalid');

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
