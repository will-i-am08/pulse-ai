import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** TikTok OAuth start scaffold — used after consent when TIKTOK_CLIENT_KEY is set. */
export async function GET(request: NextRequest) {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const token = request.nextUrl.searchParams.get('t') ?? '';
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.redirect(new URL(`/c/tiktok-consent?t=${encodeURIComponent(token)}`, base));
  }
  const redirectUri = `${base}/api/connect/tiktok/callback`;
  const scope = encodeURIComponent('user.info.basic,video.publish,video.upload');
  const state = encodeURIComponent(token);
  const url =
    `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(clientKey)}` +
    `&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  return NextResponse.redirect(url);
}
