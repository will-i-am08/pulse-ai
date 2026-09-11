import { NextResponse, type NextRequest } from 'next/server';
import { queryOne, type Brand } from '@pulse/shared';
import { loginDialogUrl } from '@/lib/meta/oauth';
import { verifySmsConnectToken, signSmsOauthState } from '@/lib/sms-connect/token';

export const dynamic = 'force-dynamic';

function metaConnected(brand: Brand): boolean {
  return Boolean(brand.ig_user_id && brand.fb_page_id && brand.platform_tokens_encrypted);
}

function adsConnected(brand: Brand): boolean {
  return Boolean(brand.ad_account_id && brand.ads_tokens_encrypted);
}

/**
 * SMS deep-link entry: /c/[token]
 * - expired → clear "ask Kip for a fresh link" page
 * - ads → OAuth (or mock connect when GRAPH_MODE=mock)
 * - already connected → status + optional reconnect
 * - else → Facebook OAuth with brand-scoped SMS state (no dashboard login)
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const verified = verifySmsConnectToken(token);
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const graphMode = process.env.GRAPH_MODE ?? 'mock';

  if (!verified.ok) {
    const msg =
      verified.reason === 'expired'
        ? "This link expired. Text Kip and ask for a fresh connect link — I'll send one straight away."
        : "That link isn't valid. Text Kip and ask to connect Instagram.";
    return new NextResponse(htmlPage('Link expired', msg), {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) {
    return new NextResponse(htmlPage('Not found', "I couldn't find that brand. Text Kip for help."), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (verified.purpose === 'ads') {
    if (adsConnected(brand) && !request.nextUrl.searchParams.has('reconnect')) {
      const name = brand.ad_account_name ?? brand.ad_account_id ?? 'your ad account';
      return new NextResponse(
        htmlPage(
          'Ad account connected',
          `You're linked to ${name}. Kip already knows. Close this and head back to your texts.`,
          `<p><a href="${base}/c/${token}?reconnect=1">Reconnect a different ad account</a></p>`,
        ),
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    // Mock mode: one-tap connect without Meta OAuth so SMS flows work end-to-end.
    if (graphMode === 'mock' || !process.env.META_APP_ID) {
      return new NextResponse(
        htmlPage(
          'Connect ad account',
          `Mock mode — tap below to link a demo ad account for ${brand.name}. Kip will text you a confirmation.`,
          `<form method="POST" action="${base}/api/connect/ads/mock">
            <input type="hidden" name="t" value="${token}" />
            <button type="submit" style="padding:12px 18px;border-radius:8px;border:0;background:#1a1a1a;color:#fff;font-size:1rem;cursor:pointer">
              Connect mock ad account
            </button>
          </form>`,
        ),
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    const state = signSmsOauthState(brand.id, 'ads');
    return NextResponse.redirect(loginDialogUrl(state, 'ads'));
  }

  if (metaConnected(brand) && !request.nextUrl.searchParams.has('reconnect')) {
    const ig = brand.ig_username ? `@${brand.ig_username}` : 'Instagram';
    const fb = brand.fb_page_name ?? 'Facebook';
    return new NextResponse(
      htmlPage(
        'Already connected',
        `You're linked: ${ig} + ${fb}. Kip already knows. Close this and head back to your texts.`,
        `<p><a href="${base}/c/${token}?reconnect=1">Reconnect with a different account</a></p>`,
      ),
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  const state = signSmsOauthState(brand.id, 'meta');
  return NextResponse.redirect(loginDialogUrl(state, 'meta'));
}

function htmlPage(title: string, body: string, extra = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Kip</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a1a;line-height:1.5}
  h1{font-size:1.35rem;margin:0 0 .75rem}
  p{margin:0 0 1rem;color:#444}
  a{color:#0b5fff}
</style></head>
<body><h1>${title}</h1><p>${body}</p>${extra}</body></html>`;
}
