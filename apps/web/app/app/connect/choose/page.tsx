import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { queryOne, decrypt, type Brand } from '@pulse/shared';
import { listManagedPages } from '@/lib/meta/oauth';
import { selectPageAction } from '@/lib/actions/connect';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Choose a page | Kip' };

const ERRORS: Record<string, string> = {
  nopage: 'Please choose a page to continue.',
  noig: 'That Page has no Instagram business account linked. Link one in the Facebook app (Page → Linked accounts), then reconnect.',
};

export default async function ChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');

  const brand = await queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user!.id],
  );
  if (!brand || !brand.platform_user_token_encrypted) redirect('/app?connect=expired');

  const pages = await listManagedPages(decrypt(brand!.platform_user_token_encrypted!));
  if (pages.length === 0) redirect('/app?connect=nopages');

  const anyWithIg = pages.some((p) => p.igUserId);
  const firstIgIndex = pages.findIndex((p) => p.igUserId);

  return (
    <section className="stage">
      <div className="page">
      <div className="page-header">
        <h1>Choose the account to connect</h1>
      </div>
      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
          Pick the Facebook Page (and its linked Instagram) Kip will post to.
        </p>
        {error && ERRORS[error] && (
          <p style={{ color: '#c0392b' }}>{ERRORS[error]}</p>
        )}

        {!anyWithIg ? (
          <p style={{ color: '#b9770e' }}>
            None of your Facebook Pages have an Instagram business account linked yet. Link an
            Instagram account to one of your Pages in the Facebook app, then reconnect.
          </p>
        ) : (
          <form action={selectPageAction}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 20px' }}>
              {pages.map((p, i) => {
                const disabled = !p.igUserId;
                return (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: 14,
                      border: '1px solid var(--border, #e2e2e8)',
                      borderRadius: 10,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="page_id"
                      value={p.id}
                      disabled={disabled}
                      defaultChecked={i === firstIgIndex}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>{p.name}</strong>
                      <br />
                      {p.igUsername ? (
                        <span style={{ color: 'var(--muted, #667)' }}>Instagram: @{p.igUsername}</span>
                      ) : (
                        <span style={{ color: '#b9770e' }}>No Instagram linked. Can’t post to this one yet</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <button className="btn-primary" type="submit">Connect this account</button>
          </form>
        )}
      </div>
      </div>
    </section>
  );
}
