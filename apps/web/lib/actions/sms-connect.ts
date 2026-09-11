'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { query, queryOne, decrypt, encryptJson, type Brand } from '@pulse/shared';
import { queueVoiceAnalysis } from '@pulse/orchestrator';
import { listManagedPages, derivePageToken, listAdAccounts } from '@/lib/meta/oauth';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

/**
 * Finalise Meta link from an SMS deep-link (no dashboard session).
 * On success, texts confirmation back into the brand thread.
 */
export async function selectPageFromSmsAction(formData: FormData): Promise<void> {
  const token = String(formData.get('t') ?? '').trim();
  const pageId = String(formData.get('page_id') ?? '').trim();
  const verified = verifySmsConnectToken(token);

  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }
  if (!pageId) redirect(`/c/choose?t=${encodeURIComponent(token)}&error=nopage`);

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) redirect('/c/done?status=nobrand');
  if (!brand.platform_user_token_encrypted) redirect('/c/done?status=expired');

  const userToken = decrypt(brand.platform_user_token_encrypted);
  const pages = await listManagedPages(userToken);
  const chosen = pages.find((p) => p.id === pageId);
  if (!chosen) redirect(`/c/choose?t=${encodeURIComponent(token)}&error=nopage`);
  if (!chosen.igUserId) redirect(`/c/choose?t=${encodeURIComponent(token)}&error=noig`);

  const pageToken = await derivePageToken(userToken, pageId);
  const encrypted = encryptJson({ ig_access_token: pageToken, fb_page_access_token: pageToken });

  await query(
    `update brands set
       fb_page_id = $1,
       fb_page_name = $2,
       ig_user_id = $3,
       ig_username = $4,
       platform_tokens_encrypted = $5,
       platform_user_token_encrypted = null,
       meta_connected_at = now()
     where id = $6`,
    [chosen.id, chosen.name, chosen.igUserId, chosen.igUsername, encrypted, brand.id],
  );

  await queueVoiceAnalysis(brand.id).catch(() => undefined);

  const ig = chosen.igUsername ? `@${chosen.igUsername}` : 'Instagram';
  const confirm = `Connected ✅ ${ig} + ${chosen.name}. I'll take it from here — send a photo any time.`;
  await sendToBrand(brand.id, confirm).catch((err) =>
    console.error('selectPageFromSmsAction: confirmation SMS failed', err),
  );

  redirect('/c/done?status=success');
}

/**
 * Finalise Meta ad-account link from an SMS deep-link.
 * Enables features.ads and texts confirmation into the brand thread.
 */
export async function selectAdAccountFromSmsAction(formData: FormData): Promise<void> {
  const token = String(formData.get('t') ?? '').trim();
  const adAccountId = String(formData.get('ad_account_id') ?? '').trim();
  const verified = verifySmsConnectToken(token);

  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }
  if (verified.purpose !== 'ads') redirect('/c/done?status=invalid');
  if (!adAccountId) redirect(`/c/choose-ads?t=${encodeURIComponent(token)}&error=noaccount`);

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) redirect('/c/done?status=nobrand');
  if (!brand.platform_user_token_encrypted) redirect('/c/done?status=expired');

  const userToken = decrypt(brand.platform_user_token_encrypted);
  const accounts = await listAdAccounts(userToken);
  const chosen = accounts.find((a) => a.id === adAccountId);
  if (!chosen) redirect(`/c/choose-ads?t=${encodeURIComponent(token)}&error=noaccount`);

  await query(
    `update brands set
       ad_account_id = $1,
       ad_account_name = $2,
       ads_tokens_encrypted = $3,
       ads_connected_at = now(),
       features = coalesce(features, '{}'::jsonb) || $4::jsonb,
       platform_user_token_encrypted = null
     where id = $5`,
    [
      chosen.id,
      chosen.name,
      encryptJson({ access_token: userToken, ad_account_id: chosen.id }),
      JSON.stringify({ ads: true }),
      brand.id,
    ],
  );

  await query(
    `insert into ad_approvals (brand_id, action, actor, after, note)
     values ($1, 'connect', 'owner', $2::jsonb, 'SMS ad account connect')`,
    [brand.id, JSON.stringify({ ad_account_id: chosen.id, features_ads: true })],
  ).catch(() => undefined);

  const confirm = `Ad account connected ✅ ${chosen.name}. Ads are on — say "boost this", "run ads for leads", or "past ads" anytime. I'll confirm before any spend.`;
  await sendToBrand(brand.id, confirm).catch((err) =>
    console.error('selectAdAccountFromSmsAction: confirmation SMS failed', err),
  );

  redirect('/c/done?status=success');
}
