'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { query, queryOne, encryptJson, type Brand, type TikTokPrivacyDefaults } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { sendToBrand } from '@pulse/gateway';

/**
 * Persist TikTok privacy + music consent, then mock-connect or redirect to OAuth.
 */
export async function confirmTikTokConsentAction(formData: FormData): Promise<void> {
  const token = String(formData.get('t') ?? '').trim();
  const verified = verifySmsConnectToken(token);
  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }
  if (verified.purpose !== 'tiktok') redirect('/c/done?status=invalid');

  const music = formData.get('music_usage_confirmed');
  if (!music) {
    redirect(`/c/tiktok-consent?t=${encodeURIComponent(token)}&error=consent`);
  }

  const privacy: TikTokPrivacyDefaults = {
    privacy_level: (String(formData.get('privacy_level') ?? 'PUBLIC_TO_EVERYONE') as TikTokPrivacyDefaults['privacy_level']),
    allow_comment: formData.get('allow_comment') === '1',
    allow_duet: formData.get('allow_duet') === '1',
    allow_stitch: formData.get('allow_stitch') === '1',
    music_usage_confirmed: true,
    aigc_disclosure: formData.get('aigc_disclosure') === '1',
  };

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) redirect('/c/done?status=nobrand');

  await query(`update brands set tiktok_privacy_defaults = $1::jsonb where id = $2`, [
    JSON.stringify(privacy),
    brand.id,
  ]);

  const graphMode = process.env.GRAPH_MODE ?? 'mock';
  const liveReady = graphMode === 'live' && Boolean(process.env.TIKTOK_CLIENT_KEY);

  if (liveReady) {
    redirect(`/api/connect/tiktok/start?t=${encodeURIComponent(token)}`);
  }

  // Mock connect (GRAPH_MODE=mock or missing client key / unaudited).
  const openId = `tt_mock_${brand.id.replace(/-/g, '').slice(0, 8)}`;
  const displayName = `${brand.name} on TikTok`;
  await query(
    `update brands set
       tiktok_open_id = $1,
       tiktok_display_name = $2,
       tiktok_tokens_encrypted = $3,
       tiktok_connected_at = now(),
       tiktok_privacy_defaults = $4::jsonb
     where id = $5`,
    [
      openId,
      displayName,
      encryptJson({
        access_token: `mock_tt_token_${brand.id}`,
        refresh_token: `mock_tt_refresh_${brand.id}`,
        expires_at: Date.now() + 60 * 24 * 3600 * 1000,
        open_id: openId,
      }),
      JSON.stringify(privacy),
      brand.id,
    ],
  );

  const confirm =
    `TikTok connected ✅ ${displayName}. Privacy: ${privacy.privacy_level.replace(/_/g, ' ').toLowerCase()}. ` +
    `Say "TikTok only" on a draft — video-first; AI video is flagged AIGC.`;
  await sendToBrand(brand.id, confirm).catch((err) =>
    console.error('tiktok consent mock connect: confirmation SMS failed', err),
  );

  redirect('/c/done?status=success');
}
