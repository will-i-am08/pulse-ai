import { getServerEnv } from "./env.js";

/**
 * LinkedIn Marketing / Community Management — Company Page organic posts.
 * OAuth 2.0 tokens live encrypted on the brand. Live calls hit documented
 * endpoint shapes; mock mode never reaches here (graph adapter falls back).
 *
 * Posts API (UGC / rest/posts): text, single image, multi-image, video.
 * Media URLs are registered via Images/Videos API before the post body is sent.
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

function restHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function orgUrn(orgId: string): string {
  return orgId.startsWith("urn:") ? orgId : `urn:li:organization:${orgId}`;
}

/** Map LinkedIn API errors to owner-facing messages (admin / partner / scope). */
export function linkedinMapError(raw: string): string {
  const msg = raw.slice(0, 400);
  if (/ACCESS_DENIED|not.?authorized|FORBIDDEN|403/i.test(msg) && /admin|organization|page/i.test(msg)) {
    return "linkedin: you need to be an admin of that Company Page — reconnect with an admin account";
  }
  if (/partner|developer.?application|not.?approved|PRODUCT|ACCESS_DENIED|FORBIDDEN/i.test(msg)) {
    return "linkedin: Marketing Developer Platform / partner approval still pending for this app";
  }
  if (/REVOKED|expired|invalid.?token|401/i.test(msg)) {
    return "linkedin: token expired or revoked — say \"connect LinkedIn\" for a fresh link";
  }
  if (/commentary|length|too long|characters/i.test(msg)) {
    return `linkedin caption too long (max 3000): ${msg}`;
  }
  return `linkedin post: ${msg}`;
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
    throw new Error(linkedinMapError(JSON.stringify(body)));
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

function isAlreadyUrn(u: string): boolean {
  return /^urn:li:(image|video|digitalmediaAsset):/i.test(u);
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
  const commentary = (input.commentary ?? "").slice(0, 3000);
  const media = (input.mediaUrls ?? []).filter(Boolean);
  const base: Record<string, unknown> = {
    author: orgUrn(input.orgId),
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

  const video = media.find(isVideoUrl) ?? media.find((u) => /^urn:li:video:/i.test(u));
  if (video && media.length === 1) {
    return {
      ...base,
      content: {
        media: {
          title: commentary.slice(0, 100) || "Video",
          id: video,
        },
      },
      _kip_media_kind: "video",
      _kip_source_url: video,
    };
  }

  const images = media.filter((u) => isImageUrl(u) || /^urn:li:image:/i.test(u)).slice(0, 9);
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

async function fetchBinary(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`linkedin media fetch failed (${res.status}) for ${url.slice(0, 80)}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: await res.arrayBuffer(), contentType };
}

/** Register + upload an image; returns urn:li:image:… */
export async function linkedinUploadImage(
  accessToken: string,
  ownerOrgId: string,
  sourceUrl: string,
): Promise<string> {
  if (isAlreadyUrn(sourceUrl)) return sourceUrl;
  const init = await fetch(`${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn(ownerOrgId) } }),
  });
  const initJson = (await init.json().catch(() => ({}))) as {
    value?: { uploadUrl?: string; image?: string };
    error?: unknown;
  };
  if (!init.ok || !initJson.value?.uploadUrl || !initJson.value?.image) {
    throw new Error(linkedinMapError(JSON.stringify(initJson.error ?? initJson).slice(0, 240)));
  }
  const { bytes, contentType } = await fetchBinary(sourceUrl);
  const put = await fetch(initJson.value.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
    },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(linkedinMapError(`image upload ${put.status}`));
  }
  return initJson.value.image;
}

/** Register + upload a video (single-part when file is small); returns urn:li:video:… */
export async function linkedinUploadVideo(
  accessToken: string,
  ownerOrgId: string,
  sourceUrl: string,
): Promise<string> {
  if (isAlreadyUrn(sourceUrl)) return sourceUrl;
  const { bytes, contentType } = await fetchBinary(sourceUrl);
  const fileSizeBytes = bytes.byteLength;
  const init = await fetch(`${REST}/videos?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: orgUrn(ownerOrgId),
        fileSizeBytes,
        uploadThumbnail: false,
      },
    }),
  });
  const initJson = (await init.json().catch(() => ({}))) as {
    value?: {
      uploadInstructions?: Array<{ uploadUrl?: string }>;
      video?: string;
      uploadUrl?: string;
    };
    error?: unknown;
  };
  if (!init.ok) {
    throw new Error(linkedinMapError(JSON.stringify(initJson.error ?? initJson).slice(0, 240)));
  }
  const uploadUrl =
    initJson.value?.uploadInstructions?.[0]?.uploadUrl ?? initJson.value?.uploadUrl;
  const videoUrn = initJson.value?.video;
  if (!uploadUrl || !videoUrn) {
    throw new Error(linkedinMapError("video initializeUpload missing uploadUrl/video"));
  }
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType.startsWith("video/") ? contentType : "video/mp4",
    },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(linkedinMapError(`video upload ${put.status}`));
  }
  // Finalize when the API returns an etag-based finalize endpoint pattern.
  try {
    await fetch(`${REST}/videos?action=finalizeUpload`, {
      method: "POST",
      headers: restHeaders(accessToken),
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken: "",
          uploadedPartIds: [put.headers.get("etag") ?? put.headers.get("ETag") ?? "0"],
        },
      }),
    });
  } catch {
    // Some LinkedIn versions auto-finalize single-part uploads.
  }
  return videoUrn;
}

/**
 * Resolve HTTP media URLs to LinkedIn media URNs via Images/Videos API.
 */
export async function linkedinResolveMediaUrns(
  input: LinkedInPublishInput,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const kind = body._kip_media_kind as string | undefined;
  if (!kind) return body;
  const next = { ...body };

  if (kind === "video" && typeof body._kip_source_url === "string") {
    const urn = await linkedinUploadVideo(input.accessToken, input.orgId, body._kip_source_url);
    next.content = { media: { title: (input.commentary ?? "").slice(0, 100) || "Video", id: urn } };
  } else if (kind === "image" && typeof body._kip_source_url === "string") {
    const urn = await linkedinUploadImage(input.accessToken, input.orgId, body._kip_source_url);
    next.content = { media: { title: (input.commentary ?? "").slice(0, 100) || "Image", id: urn } };
  } else if (kind === "multi_image" && Array.isArray(body._kip_source_urls)) {
    const urls = body._kip_source_urls as string[];
    const urns: string[] = [];
    for (const url of urls) {
      urns.push(await linkedinUploadImage(input.accessToken, input.orgId, url));
    }
    next.content = {
      multiImage: {
        images: urns.map((id, i) => ({ id, altText: `Image ${i + 1}` })),
      },
    };
  }

  delete next._kip_media_kind;
  delete next._kip_source_url;
  delete next._kip_source_urls;
  return next;
}

/**
 * Publish an organic Company Page post against the real Posts API shape.
 * Uploads image/video assets first when mediaUrls are HTTP(S).
 */
export async function linkedinPublishPost(
  input: LinkedInPublishInput,
): Promise<{ id: string; permalink: string | null }> {
  const built = linkedinBuildPostBody(input);
  const wire = await linkedinResolveMediaUrns(input, built);

  const res = await fetch(`${REST}/posts`, {
    method: "POST",
    headers: restHeaders(input.accessToken),
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
    throw new Error(linkedinMapError(JSON.stringify(json.error ?? json)));
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
