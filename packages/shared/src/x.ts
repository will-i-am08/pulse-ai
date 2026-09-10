import { getServerEnv } from "./env.js";

// Runtime X (Twitter) API v2 publishing. OAuth 2.0 user tokens live encrypted on
// the brand; access tokens expire (~2h) and X ROTATES the refresh token on use,
// so a refresh returns fresh values the caller must persist.
//
// NOTE: media upload on X is a separate multi-step flow (INIT/APPEND/FINALIZE);
// text tweets are wired here and media is a flagged follow-on. Verify exact field
// shapes against a real token + paid tier when connecting the first live account.

const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const TWEETS_URL = "https://api.twitter.com/2/tweets";

export interface XStoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function creds(): { id: string; secret: string } {
  const env = getServerEnv();
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) throw new Error("X client credentials not set");
  return { id: env.X_CLIENT_ID, secret: env.X_CLIENT_SECRET };
}
function basicAuth(): string {
  const { id, secret } = creds();
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

/** Refresh the access token. Returns BOTH tokens (X rotates the refresh token) to persist. */
export async function xRefresh(refreshToken: string): Promise<XStoredTokens> {
  const { id } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: id }),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`x refresh: ${JSON.stringify(body).slice(0, 200)}`);
  return {
    access_token: String(body.access_token),
    refresh_token: String(body.refresh_token ?? refreshToken),
    expires_at: Date.now() + Number(body.expires_in ?? 7200) * 1000,
  };
}

/**
 * A valid access token, refreshing when the stored one is within 60s of expiry.
 * `refreshed` is non-null only when a refresh happened — persist it on the brand.
 */
export async function xEnsureToken(stored: XStoredTokens): Promise<{ accessToken: string; refreshed: XStoredTokens | null }> {
  if (stored.expires_at && stored.expires_at - Date.now() > 60_000) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  const t = await xRefresh(stored.refresh_token);
  return { accessToken: t.access_token, refreshed: t };
}

/** Post a tweet (text, optionally with already-uploaded media ids). Returns the tweet id. */
export async function xPostTweet(accessToken: string, text: string, mediaIds?: string[]): Promise<string> {
  const payload: Record<string, unknown> = { text: (text ?? "").slice(0, 280) };
  if (mediaIds?.length) payload.media = { media_ids: mediaIds.slice(0, 4) };
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.errors || body.error) {
    throw new Error(`x tweet: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  }
  return String(body.data?.id ?? "");
}
