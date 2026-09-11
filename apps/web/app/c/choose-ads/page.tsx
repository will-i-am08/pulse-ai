import { redirect } from 'next/navigation';
import { queryOne, decrypt, type Brand } from '@pulse/shared';
import { listAdAccounts } from '@/lib/meta/oauth';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { selectAdAccountFromSmsAction } from '@/lib/actions/sms-connect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose ad account | Kip' };

export default async function SmsChooseAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; error?: string }>;
}) {
  const { t, error } = await searchParams;
  const verified = verifySmsConnectToken(t);
  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }
  if (verified.purpose !== 'ads') redirect('/c/done?status=invalid');

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand || !brand.platform_user_token_encrypted) redirect('/c/done?status=expired');

  const accounts = await listAdAccounts(decrypt(brand.platform_user_token_encrypted));
  if (accounts.length === 0) redirect('/c/done?status=nopages');

  return (
    <main style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1.25rem', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.35rem', marginBottom: 8 }}>Choose your ad account</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Pick the Meta ad account Kip will use for boosts and campaigns for {brand.name}.
      </p>
      {error === 'noaccount' && <p style={{ color: '#c0392b' }}>Please choose an ad account.</p>}

      <form action={selectAdAccountFromSmsAction}>
        <input type="hidden" name="t" value={t!} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 20px' }}>
          {accounts.map((a, i) => (
            <label
              key={a.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: 14,
                border: '1px solid #e2e2e8',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <input type="radio" name="ad_account_id" value={a.id} defaultChecked={i === 0} />
              <span>
                <strong>{a.name}</strong>
                <br />
                <span style={{ color: '#667' }}>
                  {a.id}
                  {a.currency ? ` · ${a.currency}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          style={{
            padding: '12px 18px',
            borderRadius: 8,
            border: 0,
            background: '#1a1a1a',
            color: '#fff',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Connect ad account
        </button>
      </form>
    </main>
  );
}
