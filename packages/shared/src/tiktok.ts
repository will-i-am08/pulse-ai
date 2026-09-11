import { getServerEnv } from "./env.js";
import type { TikTokPrivacyDefaults } from "./types.js";
import { tiktokAuditPassed } from "./types.js";

/**
 * TikTok Content Posting API — Direct Post path.
 *
 * Public (`PUBLIC_TO_EVERYONE`) Direct Post requires TIKTOK_AUDIT_PASSED.
 * Without audit, Kip may still live-post with privacy forced to SELF_ONLY
 * when client key + brand tokens are present. Documented in LIVE_CHECKLIST.
 *
 * Video-first; photo mode is secondary. Set `aigc` when the creative is AI video.
 */

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const DIRECT_POST_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const PHOTO_POST_URL = "https://open.tiktokapis.com/v2/post/publish/content/init/";

export interface TikTokStoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  open_id?: string;
}

export const DEFAULT_TIKTOK_PRIVACY: TikTokPrivacyDefaults = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  music_usage_confirmed: false,
  aigc_disclosure: true,
};

function creds(): { key: string; secret: string } {
  const env = getServerEnv();
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    throw new Error("TikTok client credentials not set");
  }
  return { key: env.TIKTOK_CLIENT_KEY, secret: env.TIKTOK_CLIENT_SECRET };
}

/** Map TikTok API / cap errors to readable messages. */
export function tiktokMapError(raw: string): string {
  const msg = raw.slice(0, 400);
  if (/title|caption|length|too long|characters|max/i.test(msg)) {
    return `tiktok caption too long (max 2200): ${msg}`;
  }
  if (/rate.?limit|quota|spam|too many|cap/i.test(msg)) {
    return `tiktok rate/cap: posting limit hit — try again later (${msg.slice(0, 120)})`;
  }
  if (/privacy|unaudited|scope|audit|SELF_ONLY|public/i.test(msg)) {
    return `tiktok privacy/audit: ${msg}`;
  }
  if (/music|commercial|consent/i.test(msg)) {
    return `tiktok: music / commercial content consent required — reopen the connect link and confirm privacy settings`;
  }
  return `tiktok post: ${msg}`;
}

/**
 * Enforce audit gate on privacy: public levels require TIKTOK_AUDIT_PASSED;
 * otherwise force SELF_ONLY for private Direct Post.
 */
export function tiktokEnforcePrivacy(
  privacy: TikTokPrivacyDefaults,
): TikTokPrivacyDefaults {
  if (tiktokAuditPassed()) return privacy;
  if (privacy.privacy_level === "SELF_ONLY") return privacy;
  return { ...privacy, privacy_level: "SELF_ONLY" };
}

export async function tiktokRefresh(refreshToken: string): Promise<TikTokStoredTokens> {
  const { key, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const body = (await res.json()) as { error?: string; data?: Record<string, unknown> } & Record<
    string,
    unknown
  >;
  if (!res.ok || body.error) {
    throw new Error(tiktokMapError(JSON.stringify(body)));
  }
  const data = (body.data ?? body) as Record<string, unknown>;
  return {
    access_token: String(data.access_token),
    refresh_token: data.refresh_token ? String(data.refresh_token) : refreshToken,
    expires_at: Date.now() + Number(data.expires_in ?? 86400) * 1000,
    open_id: data.open_id ? String(data.open_id) : undefined,
  };
}

export async function tiktokEnsureToken(
  stored: TikTokStoredTokens,
): Promise<{ accessToken: string; refreshed: TikTokStoredTokens | null }> {
  if (stored.expires_at && stored.expires_at - Date.now() > 60_000) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  if (!stored.refresh_token) {
    return { accessToken: stored.access_token, refreshed: null };
  }
  const t = await tiktokRefresh(stored.refresh_token);
  return { accessToken: t.access_token, refreshed: t };
}

function isVideoUrl(u: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
}

export type TikTokPublishInput = {
  accessToken: string;
  title: string;
  mediaUrls: string[];
  privacy?: TikTokPrivacyDefaults;
  /** True when the video is AI-generated — sets AIGC disclosure on the post. */
  aigc?: boolean;
};

/**
 * Build Direct Post init body (video) or photo content init.
 * Live client POSTs this to the matching TikTok endpoint.
 */
export function tiktokBuildDirectPostBody(input: TikTokPublishInput): {
  url: string;
  body: Record<string, unknown>;
} {
  const title = (input.title ?? "").slice(0, 2200);
  const privacy = tiktokEnforcePrivacy({ ...DEFAULT_TIKTOK_PRIVACY, ...(input.privacy ?? {}) });
  if (!privacy.music_usage_confirmed) {
    throw new Error(
      "tiktok: music / commercial content consent required — reopen the connect link and confirm privacy settings",
    );
  }

  const media = (input.mediaUrls ?? []).filter(Boolean);
  if (media.length === 0) {
    throw new Error("tiktok: needs a video (preferred) or photo — text-only posts aren't supported");
  }

  const video =
    media.find(isVideoUrl) ??
    (media.length === 1 && !/\.(jpe?g|png|gif|webp)(\?|$)/i.test(media[0]!) ? media[0] : null);

  if (video) {
    return {
      url: DIRECT_POST_URL,
      body: {
        post_info: {
          title,
          privacy_level: privacy.privacy_level,
          disable_duet: !privacy.allow_duet,
          disable_comment: !privacy.allow_comment,
          disable_stitch: !privacy.allow_stitch,
          video_cover_timestamp_ms: 1000,
          ...(input.aigc
            ? { brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true }
            : {}),
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: video,
        },
      },
    };
  }

  // Photo mode (secondary path).
  const photos = media.slice(0, 35);
  return {
    url: PHOTO_POST_URL,
    body: {
      post_info: {
        title,
        description: title,
        privacy_level: privacy.privacy_level,
        disable_comment: !privacy.allow_comment,
        auto_add_music: false,
        ...(input.aigc ? { is_aigc: true } : {}),
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: photos,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    },
  };
}

/**
 * Init a Direct Post. Public privacy requires TIKTOK_AUDIT_PASSED; otherwise
 * privacy is forced to SELF_ONLY inside tiktokBuildDirectPostBody.
 */
export async function tiktokDirectPost(
  input: TikTokPublishInput,
): Promise<{ publishId: string; permalink: string | null }> {
  const { url, body } = tiktokBuildDirectPostBody(input);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    error?: { code?: string; message?: string };
    data?: { publish_id?: string; share_id?: string };
  };
  if (!res.ok || (json.error && json.error.code && json.error.code !== "ok")) {
    throw new Error(tiktokMapError(json.error?.message ?? JSON.stringify(json)));
  }
  const publishId = String(json.data?.publish_id ?? json.data?.share_id ?? `tt_${Date.now()}`);
  return { publishId, permalink: null };
}

export { tiktokAuditPassed };
