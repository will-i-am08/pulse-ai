import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

export const dynamic = 'force-dynamic';

/**
 * LinkedIn OAuth callback scaffold.
 * Exchanges code → token when credentials exist; stores org on the brand and SMS-confirms page name.
 * Until org picker is wired, uses a placeholder org name from the token response / brand.
 */
export async function GET(request: NextRequest) {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const params = request.nextUrl.searchParams;
  if (params.get('error')) {
    return NextResponse.redirect(new URL('/c/done?status=denied', base));
  }
  const code = params.get('code');
  const state = params.get('state');
  const verified = verifySmsConnectToken(state);
  if (!verified.ok || verified.purpose !== 'linkedin' || !code) {
    return NextResponse.redirect(new URL('/c/done?status=invalid', base));
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) return NextResponse.redirect(new URL('/c/done?status=nobrand', base));

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/c/done?status=failed', base));
  }

  try {
    const redirectUri = `${base}/api/connect/linkedin/callback`;
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!tokenRes.ok || !tokens.access_token) {
      console.error('linkedin callback token error', tokens);
      return NextResponse.redirect(new URL('/c/done?status=failed', base));
    }

    // Org discovery is a follow-on (ACLS / organizationAcls). Scaffold stores a
    // provisional org id; owner can reconnect once the chooser ships.
    const orgId = `pending_${brand.id.replace(/-/g, '').slice(0, 8)}`;
    const orgName = `${brand.name} (LinkedIn)`;
    await query(
      `update brands set
         linkedin_org_id = $1,
         linkedin_org_name = $2,
         linkedin_tokens_encrypted = $3,
         linkedin_connected_at = now()
       where id = $4`,
      [
        orgId,
        orgName,
        encryptJson({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        }),
        brand.id,
      ],
    );

    const confirm = `LinkedIn connected ✅ Company Page: ${orgName}. Say "LinkedIn only" on a draft anytime.`;
    await sendToBrand(brand.id, confirm).catch((err) =>
      console.error('linkedin callback: confirmation SMS failed', err),
    );
    return NextResponse.redirect(new URL('/c/done?status=success', base));
  } catch (err) {
    console.error('linkedin callback failed', err);
    return NextResponse.redirect(new URL('/c/done?status=failed', base));
  }
}
