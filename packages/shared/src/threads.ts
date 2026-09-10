// Runtime Threads API (Meta) publishing. Long-lived (~60 day) tokens live encrypted
// on the brand and are refreshed in place. Publishing is two steps: create a media
// container (TEXT or IMAGE), then publish it.
//
// NOTE: verify exact field shapes against a real token when connecting the first
// live account. Carousels/video are a flagged follow-on; single image + text now.

const GRAPH = "https://graph.threads.net/v1.0";
const REFRESH_URL = "https://graph.threads.net/refresh_access_token";

export interface ThreadsStoredTokens {
  access_token: string;
  expires_at: number; // epoch ms
}

/** Refresh the long-lived token. Returns a fresh long-lived token + expiry. */
export async function threadsRefresh(token: string): Promise<ThreadsStoredTokens> {
  const u = new URL(REFRESH_URL);
  u.searchParams.set("grant_type", "th_refresh_token");
  u.searchParams.set("access_token", token);
  const res = await fetch(u.toString());
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`threads refresh: ${JSON.stringify(body).slice(0, 200)}`);
  return { access_token: String(body.access_token), expires_at: Date.now() + Number(body.expires_in ?? 5184000) * 1000 };
}

/**
 * A valid token, refreshing when within ~2 days of expiry. `refreshed` is non-null
 * only when a refresh happened — persist it on the brand. Refresh can fail if the
 * token is <24h old; we fall back to the current token in that case.
 */
export async function threadsEnsureToken(stored: ThreadsStoredTokens): Promise<{ accessToken: string; refreshed: ThreadsStoredTokens | null }> {
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  if (stored.expires_at && stored.expires_at - Date.now() > twoDays) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  try {
    const t = await threadsRefresh(stored.access_token);
    return { accessToken: t.access_token, refreshed: t };
  } catch {
    return { accessToken: stored.access_token, refreshed: null };
  }
}

export interface ThreadsFetchedPost {
  id: string;
  text: string | null;
  media_type: string | null; // TEXT_POST | IMAGE | VIDEO | CAROUSEL_ALBUM | ...
  media_url: string | null;
  permalink: string | null;
  timestamp: string | null;
}

/**
 * Read a user's own Threads posts, newest first, following pagination until we
 * hit `max` or run out. Read-only — used by the onboarding voice agent to learn
 * how the client writes. Best-effort: returns whatever it gathered on error.
 */
export async function threadsFetchPosts(
  userId: string,
  accessToken: string,
  max = 200,
): Promise<ThreadsFetchedPost[]> {
  const fields = "id,text,media_type,media_url,permalink,timestamp";
  const out: ThreadsFetchedPost[] = [];
  let url: string | null =
    `${GRAPH}/${userId}/threads?fields=${fields}&limit=50&access_token=${encodeURIComponent(accessToken)}`;

  try {
    while (url && out.length < max) {
      const res = await fetch(url);
      const body = (await res.json()) as any;
      if (!res.ok || body.error) break;
      for (const p of (body.data ?? []) as any[]) {
        out.push({
          id: String(p.id ?? ""),
          text: typeof p.text === "string" ? p.text : null,
          media_type: typeof p.media_type === "string" ? p.media_type : null,
          media_url: typeof p.media_url === "string" ? p.media_url : null,
          permalink: typeof p.permalink === "string" ? p.permalink : null,
          timestamp: typeof p.timestamp === "string" ? p.timestamp : null,
        });
      }
      url = body.paging?.next ?? null;
    }
  } catch {
    /* best-effort — return what we have */
  }
  return out.slice(0, max);
}

/** Publish a post to Threads (text, optionally a single image). Returns the id + permalink. */
export async function threadsPublish(
  userId: string,
  accessToken: string,
  text: string,
  imageUrl?: string,
): Promise<{ id: string; permalink: string | null }> {
  // 1. Create the media container.
  const createParams = new URLSearchParams({ access_token: accessToken, text: text ?? "" });
  if (imageUrl) {
    createParams.set("media_type", "IMAGE");
    createParams.set("image_url", imageUrl);
  } else {
    createParams.set("media_type", "TEXT");
  }
  const createRes = await fetch(`${GRAPH}/${userId}/threads`, { method: "POST", body: createParams });
  const createBody = (await createRes.json()) as any;
  if (!createRes.ok || createBody.error) throw new Error(`threads create: ${JSON.stringify(createBody.error ?? createBody).slice(0, 200)}`);
  const creationId = String(createBody.id ?? "");
  if (!creationId) throw new Error("threads create returned no id");

  // 2. Publish the container.
  const pubRes = await fetch(`${GRAPH}/${userId}/threads_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
  });
  const pubBody = (await pubRes.json()) as any;
  if (!pubRes.ok || pubBody.error) throw new Error(`threads publish: ${JSON.stringify(pubBody.error ?? pubBody).slice(0, 200)}`);
  const id = String(pubBody.id ?? "");

  // 3. Best-effort permalink lookup.
  let permalink: string | null = null;
  try {
    const pRes = await fetch(`${GRAPH}/${id}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`);
    const pBody = (await pRes.json()) as any;
    if (pRes.ok && pBody.permalink) permalink = String(pBody.permalink);
  } catch {
    /* permalink is a nicety, not required */
  }
  return { id, permalink };
}
