import 'server-only';

// Threads API (Meta) OAuth. Standard Authorization Code flow (no PKCE). The code
// exchange yields a short-lived token which we immediately swap for a long-lived
// (~60 day) token; that token is later refreshed in place.
export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'].join(',');

const AUTHORIZE_URL = 'https://threads.net/oauth/authorize';
const TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const LONG_LIVED_URL = 'https://graph.threads.net/access_token';
const ME_URL = 'https://graph.threads.net/v1.0/me';

const APP_ID = () => {
  const v = process.env.THREADS_APP_ID;
  if (!v) throw new Error('THREADS_APP_ID is not set');
  return v;
};
const APP_SECRET = () => {
  const v = process.env.THREADS_APP_SECRET;
  if (!v) throw new Error('THREADS_APP_SECRET is not set');
  return v;
};

/** Whether Threads connect is switched on (app credentials present). */
export function threadsConfigured(): boolean {
  return Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET);
}

export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/connect/threads/callback`;
}

/** Where we send the owner to authorise. */
export function authorizeUrl(state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', APP_ID());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', THREADS_SCOPES);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

export type ThreadsShortToken = { access_token: string; user_id: string };
export type ThreadsLongToken = { access_token: string; expires_in: number };

/** Exchange the auth code for a short-lived token (+ the Threads user id). */
export async function exchangeCode(code: string): Promise<ThreadsShortToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error || body.error_message) throw new Error(`threads token: ${JSON.stringify(body).slice(0, 200)}`);
  return { access_token: String(body.access_token), user_id: String(body.user_id) };
}

/** Swap a short-lived token for a long-lived (~60 day) one. */
export async function exchangeForLongLived(shortToken: string): Promise<ThreadsLongToken> {
  const u = new URL(LONG_LIVED_URL);
  u.searchParams.set('grant_type', 'th_exchange_token');
  u.searchParams.set('client_secret', APP_SECRET());
  u.searchParams.set('access_token', shortToken);
  const res = await fetch(u.toString(), { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`threads long-lived: ${JSON.stringify(body).slice(0, 200)}`);
  return { access_token: String(body.access_token), expires_in: Number(body.expires_in ?? 5184000) };
}

/** The connected Threads account (id + handle). */
export async function getMe(accessToken: string): Promise<{ id: string; username: string }> {
  const u = new URL(ME_URL);
  u.searchParams.set('fields', 'id,username');
  u.searchParams.set('access_token', accessToken);
  const res = await fetch(u.toString(), { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`threads me: ${JSON.stringify(body).slice(0, 200)}`);
  return { id: String(body.id ?? ''), username: String(body.username ?? '') };
}
