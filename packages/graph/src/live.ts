import type { Brand, Platform, ServerEnv } from "@pulse/shared";
import { decryptJson, getServerEnv } from "@pulse/shared";
import type { GraphAdapter } from "./types.js";
import { withRetry } from "./retry.js";
import { countPublished24h } from "./rateStore.js";

/**
 * Shape of the JSON blob stored (encrypted) in `brands.platform_tokens_encrypted`.
 * Exact field names are an assumption pending the real onboarding flow — adjust here
 * if workstream D's onboarding form ends up naming things differently.
 */
interface BrandTokens {
  ig_access_token?: string;
  fb_page_access_token?: string;
  [key: string]: unknown;
}

function graphUrl(env: ServerEnv, path: string): string {
  return `https://graph.facebook.com/${env.META_GRAPH_VERSION}${path}`;
}

function getTokens(brand: Brand): BrandTokens {
  if (!brand.platform_tokens_encrypted) {
    throw new Error(`Brand ${brand.id} has no platform_tokens_encrypted set`);
  }
  return decryptJson<BrandTokens>(brand.platform_tokens_encrypted);
}

async function graphFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? `Graph API error ${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return json;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll an IG media container until it is publishable. Instagram is frequently not
 * ready on the first call (verified in live testing against a real account), so
 * publish must wait for status_code FINISHED before calling media_publish.
 */
async function waitForContainer(env: ServerEnv, creationId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const status = await graphFetch(
      graphUrl(env, `/${creationId}?fields=status_code&access_token=${accessToken}`),
    );
    const code = status.status_code as string | undefined;
    if (code === "FINISHED") return;
    if (code === "ERROR") throw new Error("Instagram media container processing failed (status ERROR)");
    await sleep(3000);
  }
  throw new Error("Instagram media container not ready after polling");
}

/**
 * Real Meta Graph API calls. Structured against the real endpoint shapes so this only
 * needs real brand tokens (post Meta App Review) to go live — flip GRAPH_MODE=live.
 * Several spots are marked TODO(live) where the exact response shape needs verifying
 * against a real IG Business / FB Page token, which we don't have yet.
 */
export class LiveGraphAdapter implements GraphAdapter {
  async publish(input: {
    brand: Brand;
    platform: Platform;
    caption: string;
    mediaUrls: string[];
  }): Promise<{ externalPostId: string; permalink: string | null }> {
    const { brand, platform, caption, mediaUrls } = input;
    const env = getServerEnv();
    const tokens = getTokens(brand);

    return withRetry(`live:publish:${brand.id}:${platform}`, async () => {
      if (platform === "instagram") {
        if (!brand.ig_user_id) throw new Error(`Brand ${brand.id} missing ig_user_id`);
        const accessToken = tokens.ig_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing ig_access_token`);
        const mediaUrl = mediaUrls[0];
        if (!mediaUrl) throw new Error("Instagram publish requires at least one media URL");

        // IG content publishing is two calls: create a media container, then publish it.
        // TODO(live): confirm video vs image container fields (video_url + media_type:
        // REELS/VIDEO vs image_url) once a real IG Business account + token is wired up,
        // and confirm carousel handling for multi-image posts.
        const isVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(mediaUrl);
        const containerParams = new URLSearchParams({
          caption,
          access_token: accessToken,
          ...(isVideo ? { video_url: mediaUrl, media_type: "REELS" } : { image_url: mediaUrl }),
        });
        const container = await graphFetch(graphUrl(env, `/${brand.ig_user_id}/media`), {
          method: "POST",
          body: containerParams,
        });
        const creationId = container.id as string | undefined;
        if (!creationId) throw new Error("Instagram media container creation returned no id");

        // Wait until the container is publishable — verified necessary in live testing.
        await waitForContainer(env, creationId, accessToken);

        const publishParams = new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        });
        const published = await graphFetch(graphUrl(env, `/${brand.ig_user_id}/media_publish`), {
          method: "POST",
          body: publishParams,
        });
        const externalPostId = published.id as string;

        // TODO(live): fetch the real permalink via GET /{externalPostId}?fields=permalink
        // once a real token is available to verify field access.
        return { externalPostId, permalink: null };
      }

      if (platform === "facebook") {
        if (!brand.fb_page_id) throw new Error(`Brand ${brand.id} missing fb_page_id`);
        const accessToken = tokens.fb_page_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing fb_page_access_token`);
        const mediaUrl = mediaUrls[0];

        // TODO(live): route videos through /{page_id}/videos (different upload shape)
        // instead of /photos once we have a real page token to verify against.
        const path = mediaUrl ? `/${brand.fb_page_id}/photos` : `/${brand.fb_page_id}/feed`;
        const params = new URLSearchParams({
          access_token: accessToken,
          ...(mediaUrl ? { url: mediaUrl, caption } : { message: caption }),
        });
        const result = await graphFetch(graphUrl(env, path), { method: "POST", body: params });
        const externalPostId = (result.post_id as string | undefined) ?? (result.id as string);
        return { externalPostId, permalink: null };
      }

      throw new Error(`Unsupported platform: ${platform satisfies never}`);
    });
  }

  async fetchEngagement(
    brand: Brand,
    externalPostId: string,
    platform: Platform
  ): Promise<Record<string, number>> {
    const env = getServerEnv();
    const tokens = getTokens(brand);
    const accessToken = platform === "instagram" ? tokens.ig_access_token : tokens.fb_page_access_token;
    if (!accessToken) throw new Error(`Brand ${brand.id} missing ${platform} access token`);

    return withRetry<Record<string, number>>(`live:engagement:${externalPostId}`, async () => {
      if (platform === "instagram") {
        // Basic counts always work with pages_read_engagement. Reach/saves need the
        // instagram_manage_insights permission — verified in live testing that without
        // it the insights call 400s, so it is best-effort and must never fail the report.
        const basic = await graphFetch(
          graphUrl(env, `/${externalPostId}?fields=like_count,comments_count&access_token=${accessToken}`),
        );
        let reach = 0;
        let saves = 0;
        try {
          const insights = await graphFetch(
            graphUrl(env, `/${externalPostId}/insights?metric=reach,saved&access_token=${accessToken}`),
          );
          const metricValue = (name: string): number =>
            (insights.data as any[] | undefined)?.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
          reach = metricValue("reach");
          saves = metricValue("saved");
        } catch {
          // Insights unavailable (missing instagram_manage_insights, or the post is too new).
          // Degrade to the counts we do have rather than failing the whole engagement pull.
        }
        return {
          likes: basic.like_count ?? 0,
          comments: basic.comments_count ?? 0,
          reach,
          saves,
        } as Record<string, number>;
      }

      // Facebook Page post.
      const json = await graphFetch(
        graphUrl(
          env,
          `/${externalPostId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${accessToken}`
        )
      );
      return {
        likes: json.likes?.summary?.total_count ?? 0,
        comments: json.comments?.summary?.total_count ?? 0,
        // TODO(live): reach needs /insights?metric=post_impressions_unique with a Page token.
        reach: 0,
        shares: json.shares?.count ?? 0,
      } as Record<string, number>;
    });
  }

  async last24hCount(brand: Brand, platform: Platform): Promise<number> {
    // Meta doesn't expose a "posts published in the last N hours" endpoint — our own
    // publish ledger (posts table) is authoritative for rate limiting in both modes.
    return withRetry(`live:last24h:${brand.id}:${platform}`, () => countPublished24h(brand, platform));
  }
}
