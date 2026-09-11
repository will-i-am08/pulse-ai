import { redirect } from 'next/navigation';
import { queryOne, decrypt, type Brand } from '@pulse/shared';
import { listManagedPages } from '@/lib/meta/oauth';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';
import { selectPageFromSmsAction } from '@/lib/actions/sms-connect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose a page | Kip' };

const ERRORS: Record<string, string> = {
  nopage: 'Please choose a page to continue.',
  noig: 'That Page has no Instagram business account linked. Link one in Meta, then reconnect.',
};

export default async function SmsChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; error?: string }>;
}) {
  const { t, error } = await searchParams;
  const verified = verifySmsConnectToken(t);
  if (!verified.ok) {
    redirect(verified.reason === 'expired' ? '/c/done?status=expired' : '/c/done?status=invalid');
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand || !brand.platform_user_token_encrypted) redirect('/c/done?status=expired');

  const pages = await listManagedPages(decrypt(brand.platform_user_token_encrypted));
  if (pages.length === 0) redirect('/c/done?status=nopages');

  const anyWithIg = pages.some((p) => p.igUserId);
  const firstIgIndex = pages.findIndex((p) => p.igUserId);

  return (
    <main style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1.25rem', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.35rem', marginBottom: 8 }}>Choose the account to connect</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Pick the Facebook Page (and its linked Instagram) Kip will post to for {brand.name}.
      </p>
      {error && ERRORS[error] && <p style={{ color: '#c0392b' }}>{ERRORS[error]}</p>}

      {!anyWithIg ? (
        <p style={{ color: '#b9770e' }}>
          None of your Pages have an Instagram business account linked yet. Link one in Meta, then ask Kip for a fresh link.
        </p>
      ) : (
        <form action={selectPageFromSmsAction}>
          <input type="hidden" name="t" value={t!} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 20px' }}>
            {pages.map((p, i) => {
              const disabled = !p.igUserId;
              return (
                <label
                  key={p.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: 14,
                    border: '1px solid #e2e2e8',
                    borderRadius: 10,
                    opacity: disabled ? 0.55 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="page_id"
                    value={p.id}
                    disabled={disabled}
                    defaultChecked={i === firstIgIndex}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <br />
                    {p.igUsername ? (
                      <span style={{ color: '#667' }}>Instagram: @{p.igUsername}</span>
                    ) : (
                      <span style={{ color: '#b9770e' }}>No Instagram linked</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="submit"
            style={{
              background: '#111',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '12px 20px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Connect this account
          </button>
        </form>
      )}
    </main>
  );
}
