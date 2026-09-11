import { redirect } from 'next/navigation';
import { queryOne, type Brand } from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { confirmTikTokConsentAction } from '@/lib/actions/tiktok-consent';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'TikTok privacy & consent | Kip' };

/**
 * Required TikTok UX: privacy level + music / commercial content consent
 * before Direct Post. Works in mock and live (live then continues to OAuth).
 */
export default async function TikTokConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; error?: string }>;
}) {
  const { t, error } = await searchParams;
  const verified = verifySmsConnectToken(t);
  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }
  if (verified.purpose !== 'tiktok') redirect('/c/done?status=invalid');

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) redirect('/c/done?status=nobrand');

  const graphMode = process.env.GRAPH_MODE ?? 'mock';
  const liveReady = graphMode === 'live' && Boolean(process.env.TIKTOK_CLIENT_KEY);

  return (
    <main
      style={{
        maxWidth: 420,
        margin: '3rem auto',
        padding: '0 1.25rem',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: '1.35rem', marginBottom: 8 }}>TikTok privacy &amp; consent</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Before Kip can post for {brand.name}, confirm who can see posts and that you allow music /
        commercial content rules. Video is preferred; photos are supported as a secondary path.
      </p>
      {error === 'consent' && (
        <p style={{ color: '#c0392b' }}>Please confirm music / commercial content consent to continue.</p>
      )}

      <form action={confirmTikTokConsentAction}>
        <input type="hidden" name="t" value={t!} />

        <label style={{ display: 'block', margin: '16px 0 8px', fontWeight: 600 }}>
          Privacy level
          <select
            name="privacy_level"
            defaultValue="PUBLIC_TO_EVERYONE"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #ddd',
              fontSize: '1rem',
            }}
          >
            <option value="PUBLIC_TO_EVERYONE">Public</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
            <option value="SELF_ONLY">Only me</option>
          </select>
        </label>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
          <input type="checkbox" name="allow_comment" value="1" defaultChecked />
          <span>Allow comments</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
          <input type="checkbox" name="allow_duet" value="1" defaultChecked />
          <span>Allow Duet</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
          <input type="checkbox" name="allow_stitch" value="1" defaultChecked />
          <span>Allow Stitch</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
          <input type="checkbox" name="music_usage_confirmed" value="1" required />
          <span>
            I confirm music and commercial / branded content settings comply with TikTok&apos;s rules
            for this account.
          </span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
          <input type="checkbox" name="aigc_disclosure" value="1" defaultChecked />
          <span>Disclose AI-generated content (AIGC) when Kip posts AI video.</span>
        </label>

        {!liveReady && (
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Mock / unaudited mode — Kip will connect a demo TikTok account. Public live posts stay
            gated until <code>TIKTOK_AUDIT_PASSED</code> is set after Content Posting audit.
          </p>
        )}

        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: '12px 18px',
            borderRadius: 8,
            border: 0,
            background: '#1a1a1a',
            color: '#fff',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          {liveReady ? 'Continue to TikTok' : 'Connect TikTok (mock)'}
        </button>
      </form>
    </main>
  );
}
