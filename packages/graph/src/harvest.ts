import type { Brand, Platform } from "@pulse/shared";
import {
  decryptJson,
  getServerEnv,
  threadsEnsureToken,
  threadsFetchPosts,
  type ThreadsStoredTokens,
} from "@pulse/shared";

// Read-only harvest of a brand's own post history, used once at onboarding to
// learn their voice. This is deliberately NOT part of the frozen GraphAdapter
// interface (which is publish/engagement only) — it's a separate, additive
// capability. Instagram + Facebook read live via the Meta Graph API with the
// stored Page token; Threads reads via the shared Threads helper; X is stubbed
// until the paid X API is wired.

export interface HarvestedPost {
  platform: Platform;
  externalId: string;
  caption: string | null;
  mediaType: "image" | "video" | "carousel" | "text";
  imageUrls: string[]; // still-image URLs suitable for vision analysis
  permalink: string | null;
  timestamp: string | null; // ISO-ish string as the platform returns it
  engagement: number; // likes + comments, for ranking top performers
}

export interface HarvestResult {
  posts: HarvestedPost[];
  platforms: Platform[]; // platforms we actually read something from
}

interface BrandTokens {
  ig_access_token?: string;
  fb_page_access_token?: string;
  [key: string]: unknown;
}

const DEFAULT_MAX_PER_PLATFORM = 200;

function metaGraphUrl(path: string): string {
  const { META_GRAPH_VERSION } = getServerEnv();
  return `https://graph.facebook.com/${META_GRAPH_VERSION}${path}`;
}

async function metaFetch(url: string): Promise<any> {
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const msg = json?.error?.message ?? `Graph API error ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return json;
}

function tokensFor(brand: Brand): BrandTokens {
  if (!brand.platform_tokens_encrypted) return {};
  try {
    return decryptJson<BrandTokens>(brand.platform_tokens_encrypted);
  } catch {
    return {};
  }
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Instagram media (feed + reels + carousels), newest first, paginated. */
async function harvestInstagram(brand: Brand, token: string, max: number): Promise<HarvestedPost[]> {
  if (!brand.ig_user_id) return [];
  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count," +
    "children{media_type,media_url,thumbnail_url}";
  const out: HarvestedPost[] = [];
  let url: string | null = metaGraphUrl(
    `/${brand.ig_user_id}/media?fields=${fields}&limit=50&access_token=${encodeURIComponent(token)}`,
  );

  while (url && out.length < max) {
    const body = await metaFetch(url);
    for (const m of (body.data ?? []) as any[]) {
      const type = String(m.media_type ?? "");
      const mediaType: HarvestedPost["mediaType"] =
        type === "CAROUSEL_ALBUM" ? "carousel" : type === "VIDEO" ? "video" : "image";
      const imageUrls: string[] = [];
      if (type === "CAROUSEL_ALBUM") {
        for (const c of (m.children?.data ?? []) as any[]) {
          const cu = c.media_type === "VIDEO" ? c.thumbnail_url : c.media_url;
          if (typeof cu === "string") imageUrls.push(cu);
        }
      } else if (type === "VIDEO") {
        if (typeof m.thumbnail_url === "string") imageUrls.push(m.thumbnail_url);
      } else if (typeof m.media_url === "string") {
        imageUrls.push(m.media_url);
      }
      out.push({
        platform: "instagram",
        externalId: String(m.id ?? ""),
        caption: typeof m.caption === "string" ? m.caption : null,
        mediaType,
        imageUrls,
        permalink: typeof m.permalink === "string" ? m.permalink : null,
        timestamp: typeof m.timestamp === "string" ? m.timestamp : null,
        engagement: num(m.like_count) + num(m.comments_count),
      });
    }
    url = body.paging?.next ?? null;
  }
  return out.slice(0, max);
}

/** Facebook Page published posts, newest first, paginated. */
async function harvestFacebook(brand: Brand, token: string, max: number): Promise<HarvestedPost[]> {
  if (!brand.fb_page_id) return [];
  const fields =
    "id,message,created_time,permalink_url,full_picture," +
    "attachments{media_type,media,subattachments}," +
    "likes.summary(true),comments.summary(true)";
  const out: HarvestedPost[] = [];
  let url: string | null = metaGraphUrl(
    `/${brand.fb_page_id}/published_posts?fields=${fields}&limit=50&access_token=${encodeURIComponent(token)}`,
  );

  while (url && out.length < max) {
    const body = await metaFetch(url);
    for (const p of (body.data ?? []) as any[]) {
      const att = (p.attachments?.data ?? [])[0];
      const attType = String(att?.media_type ?? "").toLowerCase();
      const imageUrls: string[] = [];
      if (typeof p.full_picture === "string") imageUrls.push(p.full_picture);
      for (const sub of (att?.subattachments?.data ?? []) as any[]) {
        const su = sub?.media?.image?.src;
        if (typeof su === "string") imageUrls.push(su);
      }
      const mediaType: HarvestedPost["mediaType"] =
        att?.subattachments ? "carousel" : attType.includes("video") ? "video" : imageUrls.length ? "image" : "text";
      out.push({
        platform: "facebook",
        externalId: String(p.id ?? ""),
        caption: typeof p.message === "string" ? p.message : null,
        mediaType,
        imageUrls: [...new Set(imageUrls)],
        permalink: typeof p.permalink_url === "string" ? p.permalink_url : null,
        timestamp: typeof p.created_time === "string" ? p.created_time : null,
        engagement: num(p.likes?.summary?.total_count) + num(p.comments?.summary?.total_count),
      });
    }
    url = body.paging?.next ?? null;
  }
  return out.slice(0, max);
}

/** Threads posts via the shared read helper (long-lived token, refreshed in place). */
async function harvestThreads(brand: Brand, max: number): Promise<HarvestedPost[]> {
  if (!brand.threads_user_id || !brand.threads_tokens_encrypted) return [];
  const stored = decryptJson<ThreadsStoredTokens>(brand.threads_tokens_encrypted);
  const { accessToken } = await threadsEnsureToken(stored);
  const raw = await threadsFetchPosts(brand.threads_user_id, accessToken, max);
  return raw.map((p) => {
    const type = String(p.media_type ?? "").toUpperCase();
    const mediaType: HarvestedPost["mediaType"] =
      type === "CAROUSEL_ALBUM" ? "carousel" : type === "VIDEO" ? "video" : type === "IMAGE" ? "image" : "text";
    return {
      platform: "threads" as Platform,
      externalId: p.id,
      caption: p.text,
      mediaType,
      imageUrls: p.media_url && mediaType === "image" ? [p.media_url] : [],
      permalink: p.permalink,
      timestamp: p.timestamp,
      engagement: 0, // Threads read API doesn't return public counts here
    };
  });
}

/**
 * Harvest a brand's post history across every connected platform. Each platform
 * is isolated in its own try/catch: one platform failing (or lacking tokens)
 * never sinks the rest. Returns the combined posts and which platforms yielded.
 */
export async function harvestBrandPosts(
  brand: Brand,
  maxPerPlatform: number = DEFAULT_MAX_PER_PLATFORM,
): Promise<HarvestResult> {
  const tokens = tokensFor(brand);
  const posts: HarvestedPost[] = [];
  const platforms: Platform[] = [];

  const igToken = tokens.ig_access_token;
  if (brand.ig_user_id && igToken) {
    try {
      const ig = await harvestInstagram(brand, igToken, maxPerPlatform);
      if (ig.length) platforms.push("instagram");
      posts.push(...ig);
    } catch {
      /* best-effort per platform */
    }
  }

  const fbToken = tokens.fb_page_access_token;
  if (brand.fb_page_id && fbToken) {
    try {
      const fb = await harvestFacebook(brand, fbToken, maxPerPlatform);
      if (fb.length) platforms.push("facebook");
      posts.push(...fb);
    } catch {
      /* best-effort per platform */
    }
  }

  if (brand.threads_user_id && brand.threads_tokens_encrypted) {
    try {
      const th = await harvestThreads(brand, maxPerPlatform);
      if (th.length) platforms.push("threads");
      posts.push(...th);
    } catch {
      /* best-effort per platform */
    }
  }

  // X: reading a user's own timeline needs the paid X API (Basic tier). Stubbed
  // until that's wired — the shape is here so lighting it up is a drop-in.

  return { posts, platforms };
}
