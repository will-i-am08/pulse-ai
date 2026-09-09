import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

// X (Twitter) API v2 — OAuth 2.0 Authorization Code with PKCE (X mandates PKCE
// even for confidential clients). Scopes cover posting tweets and reading the
// connected user; offline.access yields a refresh token so we can post later.
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

// The PKCE verifier is stashed here (httpOnly, short-lived) between start and callback.
export const X_PKCE_COOKIE = 'x_pkce';

const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const ME_URL = 'https://api.twitter.com/2/users/me';

const CLIENT_ID = () => {
  const v = process.env.X_CLIENT_ID;
  if (!v) throw new Error('X_CLIENT_ID is not set');
  return v;
};
const CLIENT_SECRET = () => {
  const v = process.env.X_CLIENT_SECRET;
  if (!v) throw new Error('X_CLIENT_SECRET is not set');
  return v;
};

/** Whether X connect is switched on (client credentials present). */
export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/connect/x/callback`;
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A fresh PKCE pair — the verifier is stashed for the callback, the challenge goes in the URL. */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Where we send the owner to authorise. */
export function authorizeUrl(state: string, challenge: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', X_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export type XTokens = { access_token: string; refresh_token?: string; expires_in?: number };

// Confidential client: X wants HTTP Basic auth (client_id:client_secret) on the token endpoint.
function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64')}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<XTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      client_id: CLIENT_ID(),
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`x token: ${JSON.stringify(body).slice(0, 200)}`);
  return body as XTokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<XTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID() }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`x refresh: ${JSON.stringify(body).slice(0, 200)}`);
  return body as XTokens;
}

/** The connected X account (id + handle). */
export async function getMe(accessToken: string): Promise<{ id: string; username: string }> {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`x me: ${JSON.stringify(body).slice(0, 200)}`);
  return { id: String(body.data?.id ?? ''), username: String(body.data?.username ?? '') };
}
