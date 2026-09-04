import 'server-only';

// Google OAuth for CONTENT SOURCES (auto-pull). Separate from the Business
// Profile connect: the owner authorises read-only access to their Google Photos
// and Drive, we keep the refresh token (encrypted) on a content_sources row, and
// the agent polls the chosen album/folder for new media.
//
// Uses its own redirect URI (/api/connect/source/callback), which must be
// registered on the OAuth client alongside the Business Profile one.

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly',
].join(' ');

// The freshly-authorised source refresh token is stashed here (encrypted,
// httpOnly, short-lived) between the callback and the album/folder picker.
export const SOURCE_TOKEN_COOKIE = 'pulse_src_tok';

const CLIENT_ID = () => {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error('GOOGLE_CLIENT_ID is not set');
  return v;
};
const CLIENT_SECRET = () => {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  return v;
};

export function sourceRedirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/connect/source/callback`;
}

/** Where we send the owner to authorise Photos/Drive read access. */
export function sourceLoginUrl(state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID());
  u.searchParams.set('redirect_uri', sourceRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export type SourceTokens = { access_token: string; refresh_token?: string; expires_in?: number };

export async function exchangeSourceCode(code: string): Promise<SourceTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: sourceRedirectUri(),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`google source token: ${JSON.stringify(body).slice(0, 200)}`);
  return body as SourceTokens;
}

async function gGet<T = any>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`google ${url}: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return body as T;
}

export type SourceOption = { kind: 'google_drive' | 'google_photos'; id: string; title: string };

/** Folders in the owner's Drive (they'll pick one to watch). */
export async function listDriveFolders(accessToken: string): Promise<SourceOption[]> {
  const params = new URLSearchParams({
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '100',
  });
  const body = await gGet<{ files?: Array<{ id: string; name: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
  );
  return (body.files ?? []).map((f) => ({ kind: 'google_drive' as const, id: f.id, title: f.name }));
}

/** Albums in the owner's Google Photos library. */
export async function listPhotoAlbums(accessToken: string): Promise<SourceOption[]> {
  const body = await gGet<{ albums?: Array<{ id: string; title?: string }> }>(
    'https://photoslibrary.googleapis.com/v1/albums?pageSize=50',
    accessToken,
  );
  return (body.albums ?? []).map((a) => ({ kind: 'google_photos' as const, id: a.id, title: a.title ?? 'Untitled album' }));
}
