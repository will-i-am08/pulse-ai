import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

export const dynamic = 'force-dynamic';

/**
 * Mock ad-account connect for GRAPH_MODE=mock (or missing META_APP_ID).
 * Enables end-to-end SMS ads flows without real Meta tokens.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('t') ?? request.nextUrl.searchParams.get('t') ?? '').trim();
  const verified = verifySmsConnectToken(token);
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (!verified.ok || verified.purpose !== 'ads') {
    return NextResponse.redirect(
      new URL(verified.ok === false && verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid', base),
    );
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) {
    return NextResponse.redirect(new URL('/c/done?status=nobrand', base));
  }

  const mockId = `act_mock_${brand.id.replace(/-/g, '').slice(0, 8)}`;
  const features = { ...(brand.features ?? {}), ads: true };
  await query(
    `update brands set
       ad_account_id = $1,
       ad_account_name = $2,
       ads_tokens_encrypted = $3,
       ads_connected_at = now(),
       features = $4::jsonb
     where id = $5`,
    [
      mockId,
      'Mock Ad Account',
      encryptJson({ access_token: `mock_ads_token_${brand.id}`, ad_account_id: mockId }),
      JSON.stringify(features),
      brand.id,
    ],
  );

  await query(
    `insert into ad_approvals (brand_id, action, actor, after, note)
     values ($1, 'connect', 'owner', $2::jsonb, 'SMS mock ad account connect')`,
    [brand.id, JSON.stringify({ ad_account_id: mockId, features_ads: true })],
  ).catch(() => undefined);

  const confirm =
    `Ad account connected ✅ Mock Ad Account. Ads are on — say "boost this", "run ads for leads", or "past ads" anytime. I'll confirm before any spend.`;
  await sendToBrand(brand.id, confirm).catch((err) =>
    console.error('mock ads connect: confirmation SMS failed', err),
  );

  return NextResponse.redirect(new URL('/c/done?status=success', base));
}
