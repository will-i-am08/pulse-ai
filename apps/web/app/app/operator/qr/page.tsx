import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  appBaseUrl,
  collectQrCampaigns,
  normalizeSmsLeadSource,
  publicHiPath,
  publicQrPath,
  smsLeadPrefillBody,
} from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listSmsLeadSources } from '@/lib/data/sms-leads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'QR codes · Operator | Kip' };

export default async function OperatorQrPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.is_admin) redirect('/app');

  const { src: srcParam } = await searchParams;
  const extraRaw = srcParam?.trim() ?? '';
  const extra = extraRaw ? normalizeSmsLeadSource(extraRaw) : null;
  const extraInvalid = Boolean(extraRaw) && !extra;

  const observed = await listSmsLeadSources();
  const statsBySource = new Map(observed.map((row) => [row.source, row]));
  const campaigns = collectQrCampaigns({
    observed: observed.map((row) => row.source),
    extra,
  });

  let origin = '';
  try {
    origin = appBaseUrl();
  } catch {
    origin = '';
  }

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">QR codes</h1>
        <p className="lead">
          Print these on flyers, cards, and posters. Each code opens the matching /hi page, which then opens a
          prefilled text to Kip. Download the PNG, keep the URL under the code.
        </p>

        <form className="quiet-form" action="/app/operator/qr" method="get" style={{ marginBottom: 28 }}>
          <input
            type="text"
            name="src"
            placeholder="Custom slug — market, cafe-lane…"
            defaultValue={extra ?? extraRaw}
            aria-label="Campaign slug"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="pill-dark" type="submit">
            Show QR
          </button>
        </form>
        {extraInvalid ? (
          <p className="empty" style={{ marginTop: -16, marginBottom: 24 }}>
            Use a short slug: lowercase letters, numbers, hyphens. “qr” is reserved.
          </p>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {campaigns.map((campaign) => {
            const stats = campaign.source ? statsBySource.get(campaign.source) : undefined;
            const landing = publicHiPath(campaign.source);
            const pageUrl = origin ? `${origin}${landing}` : landing;
            const qrSrc = publicQrPath(campaign.source);
            const downloadHref = publicQrPath(campaign.source, { download: true });
            const prefill = smsLeadPrefillBody(campaign.source);
            return (
              <article key={campaign.source ?? 'generic'} className="brand-card" style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrSrc}
                  alt={`QR code for ${campaign.label}`}
                  width={200}
                  height={200}
                  style={{
                    display: 'block',
                    width: '100%',
                    maxWidth: 200,
                    height: 'auto',
                    background: '#fff',
                    borderRadius: 12,
                    padding: 10,
                    margin: '0 auto 12px',
                  }}
                />
                <strong style={{ display: 'block', fontSize: 17 }}>{campaign.label}</strong>
                <p className="empty" style={{ margin: '4px 0 0', wordBreak: 'break-all' }}>
                  {pageUrl}
                </p>
                <p className="empty" style={{ margin: '4px 0 0' }}>
                  Prefill “{prefill}”
                </p>
                {stats ? (
                  <p className="empty" style={{ margin: '4px 0 0' }}>
                    {stats.leads} texted · {stats.converted} signed up
                  </p>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, alignItems: 'center' }}>
                  <a className="pill-dark" href={downloadHref}>
                    Download PNG
                  </a>
                  <Link className="ghost" href={landing} target="_blank" rel="noreferrer">
                    Open page
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
