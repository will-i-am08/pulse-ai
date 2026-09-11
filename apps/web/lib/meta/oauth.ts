import 'server-only';

// Facebook Login (server-side Authorization Code flow) → durable Page + IG tokens.
// Scopes: list the user's Pages, read engagement, and publish to IG (and FB Page
// where the app has been granted pages_manage_posts). instagram_content_publish +
// instagram_basic cover Instagram publishing; business_management surfaces Pages
// owned via a Business.
export const META_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

/** Scopes for ad-account SMS connect (Marketing API). */
export const META_ADS_SCOPES = [
  'public_profile',
  'business_management',
  'ads_management',
  'ads_read',
  'pages_show_list',
].join(',');

const GV = () => process.env.META_GRAPH_VERSION || 'v21.0';
const APP_ID = () => {
  const v = process.env.META_APP_ID;
  if (!v) throw new Error('META_APP_ID is not set');
  return v;
};
const APP_SECRET = () => {
  const v = process.env.META_APP_SECRET;
  if (!v) throw new Error('META_APP_SECRET is not set');
  return v;
};

/** The exact callback URL — must match a "Valid OAuth Redirect URI" in the app. */
export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/connect/facebook/callback`;
}

/** Where we send the user to authorize. */
export function loginDialogUrl(state: string, purpose: 'meta' | 'ads' = 'meta'): string {
  const u = new URL(`https://www.facebook.com/${GV()}/dialog/oauth`);
  u.searchParams.set('client_id', APP_ID());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  // Facebook Login for Business drives permissions from a saved configuration
  // (config_id). When one is set we use it for meta; ads always requests Marketing scopes.
  const configId = process.env.META_LOGIN_CONFIG_ID;
  if (purpose === 'ads') {
    u.searchParams.set('scope', META_ADS_SCOPES);
  } else if (configId) {
    u.searchParams.set('config_id', configId);
  } else {
    u.searchParams.set('scope', META_SCOPES);
  }
  return u.toString();
}

async function graphGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`https://graph.facebook.com/${GV()}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(`graph ${path}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
  }
  return body as T;
}

/** Authorization code → short-lived user access token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = await graphGet<{ access_token: string }>('oauth/access_token', {
    client_id: APP_ID(),
    client_secret: APP_SECRET(),
    redirect_uri: redirectUri(),
    code,
  });
  return body.access_token;
}

/** Short-lived → long-lived (~60 day) user token. */
export async function toLongLivedUserToken(shortToken: string): Promise<string> {
  const body = await graphGet<{ access_token: string }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: APP_ID(),
    client_secret: APP_SECRET(),
    fb_exchange_token: shortToken,
  });
  return body.access_token;
}

export type ManagedPage = {
  id: string;
  name: string;
  igUserId: string | null;
  igUsername: string | null;
};

/** The Pages this user manages, with any linked Instagram business account. */
export async function listManagedPages(userToken: string): Promise<ManagedPage[]> {
  const body = await graphGet<{ data: any[] }>('me/accounts', {
    fields: 'name,id,instagram_business_account{id,username}',
    limit: '100',
    access_token: userToken,
  });
  return (body.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name ?? 'Untitled Page'),
    igUserId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
    igUsername: p.instagram_business_account?.username ? String(p.instagram_business_account.username) : null,
  }));
}

export type ManagedAdAccount = {
  id: string;
  accountId: string;
  name: string;
  currency: string | null;
};

/** Ad accounts the user can manage (Marketing API). */
export async function listAdAccounts(userToken: string): Promise<ManagedAdAccount[]> {
  const body = await graphGet<{ data: any[] }>('me/adaccounts', {
    fields: 'id,account_id,name,currency,account_status',
    limit: '50',
    access_token: userToken,
  });
  return (body.data ?? []).map((a) => ({
    id: String(a.id),
    accountId: String(a.account_id ?? a.id),
    name: String(a.name ?? 'Ad Account'),
    currency: a.currency ? String(a.currency) : null,
  }));
}

/** Derive the (non-expiring) Page access token for one Page the user manages. */
export async function derivePageToken(userToken: string, pageId: string): Promise<string> {
  const body = await graphGet<{ access_token: string }>(`${pageId}`, {
    fields: 'access_token',
    access_token: userToken,
  });
  if (!body.access_token) throw new Error('No page access_token — is the user an admin of this Page?');
  return body.access_token;
}
