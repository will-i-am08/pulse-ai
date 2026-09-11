import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

export const dynamic = 'force-dynamic';

/** TikTok OAuth callback scaffold — stores tokens; SMS confirms display name. */
export async function GET(request: NextRequest) {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const params = request.nextUrl.searchParams;
  if (params.get('error')) {
    return NextResponse.redirect(new URL('/c/done?status=denied', base));
  }
  const code = params.get('code');
  const state = params.get('state');
  const verified = verifySmsConnectToken(state);
  if (!verified.ok || verified.purpose !== 'tiktok' || !code) {
    return NextResponse.redirect(new URL('/c/done?status=invalid', base));
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) return NextResponse.redirect(new URL('/c/done?status=nobrand', base));

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    return NextResponse.redirect(new URL('/c/done?status=failed', base));
  }

  try {
    const redirectUri = `${base}/api/connect/tiktok/callback`;
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const json = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      error?: string;
      data?: Record<string, unknown>;
    };
    const data = (json.data ?? json) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? json.access_token ?? '');
    if (!tokenRes.ok || !accessToken) {
      console.error('tiktok callback token error', json);
      return NextResponse.redirect(new URL('/c/done?status=failed', base));
    }

    const openId = String(data.open_id ?? json.open_id ?? `tt_${brand.id.slice(0, 8)}`);
    const displayName = brand.tiktok_display_name ?? `${brand.name} on TikTok`;
    await query(
      `update brands set
         tiktok_open_id = $1,
         tiktok_display_name = $2,
         tiktok_tokens_encrypted = $3,
         tiktok_connected_at = now()
       where id = $4`,
      [
        openId,
        displayName,
        encryptJson({
          access_token: accessToken,
          refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
          expires_at: Date.now() + Number(data.expires_in ?? json.expires_in ?? 86400) * 1000,
          open_id: openId,
        }),
        brand.id,
      ],
    );

    const confirm = `TikTok connected ✅ ${displayName}. Say "TikTok only" on a draft — video-first.`;
    await sendToBrand(brand.id, confirm).catch((err) =>
      console.error('tiktok callback: confirmation SMS failed', err),
    );
    return NextResponse.redirect(new URL('/c/done?status=success', base));
  } catch (err) {
    console.error('tiktok callback failed', err);
    return NextResponse.redirect(new URL('/c/done?status=failed', base));
  }
}
