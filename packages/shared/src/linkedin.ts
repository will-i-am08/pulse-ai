import { getServerEnv } from "./env.js";

/**
 * LinkedIn Marketing / Community Management — Company Page organic posts.
 * OAuth 2.0 tokens live encrypted on the brand. Live calls hit documented
 * endpoint shapes; mock mode never reaches here (graph adapter falls back).
 *
 * Posts API (UGC / rest/posts): text, single image, multi-image, video.
 * Exact field names verified against the first real Company Page token.
 */

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REST = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = "202405";

export interface LinkedInStoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

function creds(): { id: string; secret: string } {
  const env = getServerEnv();
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    throw new Error("LinkedIn client credentials not set");
  }
  return { id: env.LINKEDIN_CLIENT_ID, secret: env.LINKEDIN_CLIENT_SECRET };
}

/** Refresh the access token when a refresh_token is present. */
export async function linkedinRefresh(refreshToken: string): Promise<LinkedInStoredTokens> {
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.error) {
    throw new Error(`linkedin refresh: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return {
    access_token: String(body.access_token),
    refresh_token: body.refresh_token ? String(body.refresh_token) : refreshToken,
    expires_at: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  };
}

export async function linkedinEnsureToken(
  stored: LinkedInStoredTokens,
): Promise<{ accessToken: string; refreshed: LinkedInStoredTokens | null }> {
  if (stored.expires_at && stored.expires_at - Date.now() > 60_000) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  if (!stored.refresh_token) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  const t = await linkedinRefresh(stored.refresh_token);
  return { accessToken: t.access_token, refreshed: t };
}

function isVideoUrl(u: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
}

function isImageUrl(u: string): boolean {
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u) || (!isVideoUrl(u) && Boolean(u));
}

export type LinkedInPublishInput = {
  orgId: string; // numeric org id or URN
  accessToken: string;
  commentary: string;
  mediaUrls?: string[];
};

/**
 * Build the LinkedIn Posts API payload shape (text / image / multi-image / video).
 * Live publish posts this JSON to `/rest/posts` with LinkedIn-Version header.
 */
export function linkedinBuildPostBody(input: LinkedInPublishInput): Record<string, unknown> {
  const orgUrn = input.orgId.startsWith("urn:")
    ? input.orgId
    : `urn:li:organization:${input.orgId}`;
  const commentary = (input.commentary ?? "").slice(0, 3000);
  const media = (input.mediaUrls ?? []).filter(Boolean);
  const base: Record<string, unknown> = {
    author: orgUrn,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (media.length === 0) {
    return base;
  }

  const video = media.find(isVideoUrl);
  if (video && media.length === 1) {
    // Video: content.media is a registered media URN after upload; we pass the
    // public URL as a register-upload hint for the live client to resolve.
    return {
      ...base,
      content: {
        media: {
          title: commentary.slice(0, 100) || "Video",
          id: video, // live client swaps to urn:li:video:… after upload
        },
      },
      _kip_media_kind: "video",
      _kip_source_url: video,
    };
  }

  const images = media.filter(isImageUrl).slice(0, 9);
  if (images.length === 1) {
    return {
      ...base,
      content: {
        media: {
          title: commentary.slice(0, 100) || "Image",
          id: images[0],
        },
      },
      _kip_media_kind: "image",
      _kip_source_url: images[0],
    };
  }
  if (images.length > 1) {
    return {
      ...base,
      content: {
        multiImage: {
          images: images.map((url, i) => ({
            id: url,
            altText: `Image ${i + 1}`,
          })),
        },
      },
      _kip_media_kind: "multi_image",
      _kip_source_urls: images,
    };
  }

  return base;
}

/**
 * Publish an organic Company Page post. Uses Posts API shape; media URNs are
 * expected to already be uploaded when calling live with real assets. When
 * `_kip_source_url(s)` are still HTTP URLs, LinkedIn will reject — the graph
 * live adapter registers uploads first in a follow-on, or mock mode is used.
 */
export async function linkedinPublishPost(
  input: LinkedInPublishInput,
): Promise<{ id: string; permalink: string | null }> {
  const body = linkedinBuildPostBody(input);
  // Strip Kip-only hints before the wire call.
  const { _kip_media_kind: _k, _kip_source_url: _u, _kip_source_urls: _us, ...wire } = body as Record<
    string,
    unknown
  > & {
    _kip_media_kind?: string;
    _kip_source_url?: string;
    _kip_source_urls?: string[];
  };

  const res = await fetch(`${REST}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(wire),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const msg = JSON.stringify(json.error ?? json).slice(0, 240);
    if (/commentary|length|too long|characters/i.test(msg)) {
      throw new Error(`linkedin caption too long (max 3000): ${msg}`);
    }
    throw new Error(`linkedin post: ${msg}`);
  }
  const id =
    (res.headers.get("x-restli-id") as string | null) ||
    String(json.id ?? json.postId ?? `li_${Date.now()}`);
  const org = input.orgId.replace(/^urn:li:organization:/, "");
  const permalink = id.startsWith("urn:")
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}`
    : `https://www.linkedin.com/company/${org}/posts`;
  return { id, permalink };
}
