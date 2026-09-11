import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

export const dynamic = 'force-dynamic';

/**
 * Mock LinkedIn Company Page connect for GRAPH_MODE=mock (or missing LINKEDIN_CLIENT_ID).
 * Confirms the page name back into the brand SMS thread.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('t') ?? request.nextUrl.searchParams.get('t') ?? '').trim();
  const pageName = String(form?.get('page_name') ?? '').trim() || 'Mock Company Page';
  const verified = verifySmsConnectToken(token);
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (!verified.ok || verified.purpose !== 'linkedin') {
    return NextResponse.redirect(
      new URL(
        verified.ok === false && verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid',
        base,
      ),
    );
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) {
    return NextResponse.redirect(new URL('/c/done?status=nobrand', base));
  }

  const mockOrgId = `org_mock_${brand.id.replace(/-/g, '').slice(0, 8)}`;
  await query(
    `update brands set
       linkedin_org_id = $1,
       linkedin_org_name = $2,
       linkedin_tokens_encrypted = $3,
       linkedin_connected_at = now()
     where id = $4`,
    [
      mockOrgId,
      pageName,
      encryptJson({
        access_token: `mock_li_token_${brand.id}`,
        refresh_token: `mock_li_refresh_${brand.id}`,
        expires_at: Date.now() + 60 * 24 * 3600 * 1000,
      }),
      brand.id,
    ],
  );

  const confirm = `LinkedIn connected ✅ Company Page: ${pageName}. Say "LinkedIn only" on a draft anytime and I'll post there.`;
  await sendToBrand(brand.id, confirm).catch((err) =>
    console.error('mock linkedin connect: confirmation SMS failed', err),
  );

  return NextResponse.redirect(new URL('/c/done?status=success', base));
}
