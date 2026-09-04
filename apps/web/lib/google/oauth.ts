import 'server-only';

// Google OAuth for the Business Profile API. The owner authorises access to
// their Google Business Profile; we keep the refresh token (encrypted) and the
// chosen location, then post to the profile and sync its reviews.

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

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

/** Whether Google connect is configured (client credentials present). */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/connect/google/callback`;
}

/** Where we send the owner to authorise. offline + consent to always get a refresh token. */
export function loginUrl(state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export type GoogleTokens = { access_token: string; refresh_token?: string; expires_in?: number };

export async function exchangeCodeForToken(code: string): Promise<GoogleTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`google token: ${JSON.stringify(body).slice(0, 200)}`);
  return body as GoogleTokens;
}

/** Exchange a stored refresh token for a fresh access token (used at post/sync time). */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`google refresh: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token as string;
}

async function gGet<T = any>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`google ${url}: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return body as T;
}

export type GbpLocation = { name: string; title: string; account: string };

/** The GBP locations the owner manages (across all their accounts). */
export async function listLocations(accessToken: string): Promise<GbpLocation[]> {
  const accounts = await gGet<{ accounts?: Array<{ name: string }> }>(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    accessToken,
  );
  const out: GbpLocation[] = [];
  for (const acc of accounts.accounts ?? []) {
    const locs = await gGet<{ locations?: Array<{ name: string; title: string }> }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title&pageSize=100`,
      accessToken,
    );
    for (const l of locs.locations ?? []) out.push({ name: l.name, title: l.title, account: acc.name });
  }
  return out;
}
