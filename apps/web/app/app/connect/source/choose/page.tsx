import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { decryptJson } from '@pulse/shared';
import { refreshAccessToken } from '@/lib/google/oauth';
import { listDriveFolders, listPhotoAlbums, SOURCE_TOKEN_COOKIE, type SourceOption } from '@/lib/google/sources';
import { selectSourceAction } from '@/lib/actions/source';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose a photo source — Pulse' };

export default async function ChooseSourcePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');

  const jar = await cookies();
  const cookie = jar.get(SOURCE_TOKEN_COOKIE)?.value;
  if (!cookie) redirect('/app?source=expired');

  const { refresh_token } = decryptJson<{ refresh_token: string }>(cookie!);
  const accessToken = await refreshAccessToken(refresh_token);

  // List both — one provider failing (e.g. its API not enabled) shouldn't hide the other.
  let options: SourceOption[] = [];
  const [drive, photos] = await Promise.allSettled([listDriveFolders(accessToken), listPhotoAlbums(accessToken)]);
  if (drive.status === 'fulfilled') options = options.concat(drive.value);
  if (photos.status === 'fulfilled') options = options.concat(photos.value);

  if (options.length === 0) redirect('/app?source=noitems');

  return (
    <section>
      <div className="page-header">
        <h1>Choose a photo source</h1>
      </div>
      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
          Pick the album or folder your agent should watch. New photos you add there get drafted into posts automatically.
        </p>
        {error === 'nopick' && <p style={{ color: '#c0392b' }}>Please choose a source to continue.</p>}
        <form action={selectSourceAction}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 20px' }}>
            {options.map((o, i) => (
              <label
                key={`${o.kind}:${o.id}`}
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
                <input type="radio" name="source" value={`${o.kind}:${o.id}`} defaultChecked={i === 0} />
                <span>
                  <strong>{o.title}</strong>{' '}
                  <span style={{ fontSize: 13, color: 'var(--muted, #667)' }}>
                    · {o.kind === 'google_drive' ? 'Drive folder' : 'Photos album'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button className="btn-primary" type="submit">Watch this source</button>
        </form>
      </div>
    </section>
  );
}
