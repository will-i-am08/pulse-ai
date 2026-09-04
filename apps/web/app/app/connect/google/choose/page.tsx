import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { queryOne, decryptJson, type Brand } from '@pulse/shared';
import { refreshAccessToken, listLocations } from '@/lib/google/oauth';
import { selectGbpLocationAction } from '@/lib/actions/google';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose your Google location — Pulse' };

export default async function ChooseGbpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');

  const brand = await queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user!.id],
  );
  if (!brand || !brand.google_tokens_encrypted) redirect('/app?google=expired');

  const { refresh_token } = decryptJson<{ refresh_token: string }>(brand!.google_tokens_encrypted!);
  const accessToken = await refreshAccessToken(refresh_token);
  const locations = await listLocations(accessToken);
  if (locations.length === 0) redirect('/app?google=nolocations');

  return (
    <section>
      <div className="page-header">
        <h1>Choose your Google location</h1>
      </div>
      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
          Pick the Google Business Profile your agent will post to and manage reviews for.
        </p>
        {error === 'noloc' && <p style={{ color: '#c0392b' }}>Please choose a location to continue.</p>}
        <form action={selectGbpLocationAction}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 20px' }}>
            {locations.map((l, i) => (
              <label
                key={l.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  border: '1px solid var(--border, #e2e2e8)',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                <input type="radio" name="location" value={l.name} defaultChecked={i === 0} />
                <strong>{l.title || l.name}</strong>
              </label>
            ))}
          </div>
          <button className="btn-primary" type="submit">Connect this location</button>
        </form>
      </div>
    </section>
  );
}
