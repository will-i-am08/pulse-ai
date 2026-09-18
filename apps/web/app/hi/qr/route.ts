import QRCode from 'qrcode';
import { NextResponse } from 'next/server';
import { appBaseUrl, normalizeSmsLeadSource, publicHiPath } from '@pulse/shared';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const source = normalizeSmsLeadSource(url.searchParams.get('src'));
  const download = url.searchParams.get('download') === '1';
  const target = `${appBaseUrl()}${publicHiPath(source)}`;
  const png = await QRCode.toBuffer(target, {
    type: 'png',
    width: 1024,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1d1d1f', light: '#ffffff' },
  });
  const filename = source ? `kip-hi-${source}.png` : 'kip-hi.png';
  return new NextResponse(Uint8Array.from(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    },
  });
}
