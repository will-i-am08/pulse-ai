import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Live LinkedIn OAuth start (scaffold).
 * When LINKEDIN_CLIENT_ID is set, redirects to LinkedIn's auth dialog.
 * Mock flows use /api/connect/linkedin/mock instead.
 */
export async function GET(request: NextRequest) {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const token = request.nextUrl.searchParams.get('t') ?? '';
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL(`/c/${token}`, base));
  }
  const redirectUri = `${base}/api/connect/linkedin/callback`;
  const scope = encodeURIComponent('openid profile w_organization_social r_organization_social');
  const state = encodeURIComponent(token);
  const url =
    `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`;
  return NextResponse.redirect(url);
}
