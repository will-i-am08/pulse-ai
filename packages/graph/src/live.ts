import type { Brand, Interaction, Platform, PostFormat, ServerEnv, XStoredTokens, ThreadsStoredTokens } from "@pulse/shared";
import { decryptJson, encryptJson, getServerEnv, query, xEnsureToken, xPostTweet, threadsEnsureToken, threadsPublish } from "@pulse/shared";
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
    format?: PostFormat;
  }): Promise<{ externalPostId: string; permalink: string | null }> {
    const { brand, platform, caption, mediaUrls } = input;
    const format: PostFormat = input.format ?? "feed";

    // Threads: live once the app is configured (THREADS_APP_ID) and the brand has
    // connected an account. Until then, fall back to the mock feed so nothing breaks.
    if (platform === "threads") {
      if (!getServerEnv().THREADS_APP_ID || !brand.threads_tokens_encrypted || !brand.threads_user_id) {
        const { MockGraphAdapter } = await import("./mock.js");
        return new MockGraphAdapter().publish(input);
      }
      return withRetry(`live:publish:${brand.id}:threads`, async () => {
        const stored = decryptJson<ThreadsStoredTokens>(brand.threads_tokens_encrypted!);
        const { accessToken, refreshed } = await threadsEnsureToken(stored);
        if (refreshed) {
          await query("update brands set threads_tokens_encrypted = $1 where id = $2", [encryptJson(refreshed), brand.id]);
        }
        // Text, plus a single image when we have one; carousels/video are a flagged follow-on.
        const { id, permalink } = await threadsPublish(brand.threads_user_id!, accessToken, caption, mediaUrls[0]);
        return { externalPostId: id, permalink };
      });
    }

    // X: live once the app is configured (X_CLIENT_ID) and the brand has connected
    // an account. Until then, fall back to the mock feed so nothing breaks.
    if (platform === "x") {
      if (!getServerEnv().X_CLIENT_ID || !brand.x_tokens_encrypted) {
        const { MockGraphAdapter } = await import("./mock.js");
        return new MockGraphAdapter().publish(input);
      }
      return withRetry(`live:publish:${brand.id}:x`, async () => {
        const stored = decryptJson<XStoredTokens>(brand.x_tokens_encrypted!);
        const { accessToken, refreshed } = await xEnsureToken(stored);
        if (refreshed) {
          await query("update brands set x_tokens_encrypted = $1 where id = $2", [encryptJson(refreshed), brand.id]);
        }
        // Text-only for now; X media upload is a flagged follow-on.
        const id = await xPostTweet(accessToken, caption);
        const permalink = brand.x_username ? `https://x.com/${brand.x_username}/status/${id}` : null;
        return { externalPostId: id, permalink };
      });
    }

    const env = getServerEnv();
    const tokens = getTokens(brand);

    return withRetry(`live:publish:${brand.id}:${platform}`, async () => {
      if (platform === "instagram") {
        if (!brand.ig_user_id) throw new Error(`Brand ${brand.id} missing ig_user_id`);
        const accessToken = tokens.ig_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing ig_access_token`);
        const igUser = brand.ig_user_id;
        const mediaUrl = mediaUrls[0];
        if (!mediaUrl) throw new Error("Instagram publish requires at least one media URL");
        const isVideo = (u: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(u);

        // Create a media container, wait until it's publishable, return its id.
        const createContainer = async (params: URLSearchParams): Promise<string> => {
          const container = await graphFetch(graphUrl(env, `/${igUser}/media`), { method: "POST", body: params });
          const id = container.id as string | undefined;
          if (!id) throw new Error("Instagram media container creation returned no id");
          await waitForContainer(env, id, accessToken);
          return id;
        };

        let creationId: string;
        if (format === "carousel" && mediaUrls.length > 1) {
          // Carousel: a child container per item, then a parent CAROUSEL container.
          const childIds: string[] = [];
          for (const url of mediaUrls.slice(0, 10)) {
            const childParams = new URLSearchParams({
              access_token: accessToken,
              is_carousel_item: "true",
              ...(isVideo(url) ? { video_url: url, media_type: "VIDEO" } : { image_url: url }),
            });
            childIds.push(await createContainer(childParams));
          }
          creationId = await createContainer(
            new URLSearchParams({ caption, access_token: accessToken, media_type: "CAROUSEL", children: childIds.join(",") }),
          );
        } else if (format === "story") {
          // Story: a STORIES-type container (no caption on stories).
          creationId = await createContainer(
            new URLSearchParams({
              access_token: accessToken,
              media_type: "STORIES",
              ...(isVideo(mediaUrl) ? { video_url: mediaUrl } : { image_url: mediaUrl }),
            }),
          );
        } else {
          // Single feed post (image or reel-style video).
          creationId = await createContainer(
            new URLSearchParams({
              caption,
              access_token: accessToken,
              ...(isVideo(mediaUrl) ? { video_url: mediaUrl, media_type: "REELS" } : { image_url: mediaUrl }),
            }),
          );
        }

        const published = await graphFetch(graphUrl(env, `/${igUser}/media_publish`), {
          method: "POST",
          body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
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
    if (platform === "x" || platform === "threads") {
      const { MockGraphAdapter } = await import("./mock.js");
      return new MockGraphAdapter().fetchEngagement(brand, externalPostId, platform);
    }
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

  /**
   * Post an auto-approved reply (or qualified lead answer) back to the platform.
   */
  async reply(input: {
    brand: Brand;
    interaction: Interaction;
    body: string;
  }): Promise<{ externalReplyId: string | null }> {
    const { brand, interaction, body } = input;
    const env = getServerEnv();
    const tokens = getTokens(brand);

    return withRetry(`live:reply:${interaction.id}`, async () => {
      if (interaction.platform === "instagram") {
        const accessToken = tokens.ig_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing ig_access_token`);
        if (interaction.kind === "dm") {
          if (!brand.ig_user_id) throw new Error(`Brand ${brand.id} missing ig_user_id`);
          if (!interaction.author) throw new Error(`DM interaction ${interaction.id} has no sender id to reply to`);
          const json = await graphFetch(graphUrl(env, `/${brand.ig_user_id}/messages`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: interaction.author },
              messaging_type: "RESPONSE",
              message: { text: body },
              access_token: accessToken,
            }),
          });
          return { externalReplyId: (json.message_id as string | undefined) ?? null };
        }
        if (!interaction.external_id) throw new Error(`Interaction ${interaction.id} has no comment id to reply to`);
        const json = await graphFetch(graphUrl(env, `/${interaction.external_id}/replies`), {
          method: "POST",
          body: new URLSearchParams({ message: body, access_token: accessToken }),
        });
        return { externalReplyId: (json.id as string | undefined) ?? null };
      }

      if (interaction.platform === "facebook") {
        const accessToken = tokens.fb_page_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing fb_page_access_token`);
        if (interaction.kind === "dm") {
          if (!brand.fb_page_id) throw new Error(`Brand ${brand.id} missing fb_page_id`);
          if (!interaction.author) throw new Error(`DM interaction ${interaction.id} has no sender id to reply to`);
          const json = await graphFetch(graphUrl(env, `/${brand.fb_page_id}/messages`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: interaction.author },
              messaging_type: "RESPONSE",
              message: { text: body },
              access_token: accessToken,
            }),
          });
          return { externalReplyId: (json.message_id as string | undefined) ?? null };
        }
        if (!interaction.external_id) throw new Error(`Interaction ${interaction.id} has no comment id to reply to`);
        const json = await graphFetch(graphUrl(env, `/${interaction.external_id}/comments`), {
          method: "POST",
          body: new URLSearchParams({ message: body, access_token: accessToken }),
        });
        return { externalReplyId: (json.id as string | undefined) ?? null };
      }

      throw new Error(`live:reply — unsupported platform '${interaction.platform}'`);
    });
  }

  /** Hide obvious spam from public view. DMs and reviews have nothing to hide — no-op. */
  async hide(input: { brand: Brand; interaction: Interaction }): Promise<void> {
    const { brand, interaction } = input;
    if (interaction.kind !== "comment" && interaction.kind !== "mention") return;
    if (!interaction.external_id) throw new Error(`Interaction ${interaction.id} has no comment id to hide`);
    const env = getServerEnv();
    const tokens = getTokens(brand);

    return withRetry(`live:hide:${interaction.id}`, async () => {
      if (interaction.platform === "instagram") {
        const accessToken = tokens.ig_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing ig_access_token`);
        await graphFetch(graphUrl(env, `/${interaction.external_id}/hide`), {
          method: "POST",
          body: new URLSearchParams({ hide: "true", access_token: accessToken }),
        });
        return;
      }
      if (interaction.platform === "facebook") {
        const accessToken = tokens.fb_page_access_token;
        if (!accessToken) throw new Error(`Brand ${brand.id} missing fb_page_access_token`);
        await graphFetch(graphUrl(env, `/${interaction.external_id}`), {
          method: "POST",
          body: new URLSearchParams({ is_hidden: "true", access_token: accessToken }),
        });
        return;
      }
    });
  }
}
