import { query, getServerEnv, platformLabel } from "@pulse/shared";
import type { Brand, Post } from "@pulse/shared";
import { getGraphAdapter, didPublishLive, publishConfirmation } from "@pulse/graph";
import type { GraphAdapter } from "@pulse/graph";
import { sendToBrand } from "@pulse/gateway";
import { logger } from "../lib/logger.js";
import { withRetry } from "../lib/retry.js";
import { resolveMediaUrls } from "../lib/media.js";
import { checkRateLimit } from "./rateLimit.js";
import { hasApprovedLog } from "./assertApproved.js";
import { writeApprovalLog } from "./approvalLog.js";
import { MAX_PUBLISH_ATTEMPTS, PUBLISH_BACKOFF_BASE_MINUTES, operatorPhone } from "../config.js";

function brandFacingPublishError(platform: string, message: string): string | null {
  if (platform !== "linkedin" && platform !== "tiktok") return null;
  const name = platformLabel(platform);
  if (/caption too long|too long \(max/i.test(message)) {
    const max = platform === "linkedin" ? 3000 : 2200;
    return `${name} rejected that caption — keep it under ${max} characters, then approve again. Other destinations are unaffected.`;
  }
  if (/music|consent|privacy|unaudited|audit/i.test(message)) {
    return `${name} needs privacy / music consent before I can post. Say "connect TikTok" for a fresh link. Other destinations are unaffected.`;
  }
  if (/video|photo|media|needs a video/i.test(message)) {
    return `${name} needs video (or a photo) — text-only isn't supported. Other destinations are unaffected.`;
  }
  return `${name} publish failed (${message.slice(0, 120)}). Other destinations are unaffected.`;
}

export interface PublishLoopDeps {
  graph: GraphAdapter;
  sendToBrand: typeof sendToBrand;
  now: () => Date;
}

export function defaultPublishLoopDeps(): PublishLoopDeps {
  return {
    graph: getGraphAdapter(),
    sendToBrand,
    now: () => new Date(),
  };
}

type PostWithBrand = Post & { brand: Brand | undefined };

async function fetchDuePosts(now: Date): Promise<PostWithBrand[]> {
  // status in ('approved','scheduled') and (scheduled_at is null or scheduled_at <= now())
  const posts = await query<Post>(
    `select * from posts
     where status in ('approved', 'scheduled')
       and (scheduled_at is null or scheduled_at <= $1)
     order by scheduled_at asc nulls first`,
    [now.toISOString()],
  );
  if (posts.length === 0) return [];

  const brandIds = [...new Set(posts.map((p) => p.brand_id))];
  const brands = await query<Brand>(`select * from brands where id = any($1::uuid[])`, [brandIds]);
  const brandById = new Map(brands.map((b) => [b.id, b]));

  return posts.map((post) => ({ ...post, brand: brandById.get(post.brand_id) }));
}

/** Publish loop — runs every minute from src/index.ts. */
export async function runPublishLoop(deps: PublishLoopDeps = defaultPublishLoopDeps()): Promise<void> {
  const { now } = deps;

  let due: PostWithBrand[];
  try {
    due = await fetchDuePosts(now());
  } catch (err) {
    logger.error("publish loop: failed to fetch due posts", { error: String(err) });
    return;
  }

  for (const post of due) {
    await processPost(post, deps).catch((err) => {
      logger.error(`publish loop: unhandled error processing post ${post.id}`, { error: String(err) });
    });
  }
}

async function processPost(post: PostWithBrand, deps: PublishLoopDeps): Promise<void> {
  const { graph, sendToBrand: send } = deps;
  const brand = post.brand;
  if (!brand) {
    logger.error(`post ${post.id} has no linked brand — skipping`);
    return;
  }

  // Approval is absolute. This should never trip if the dashboard is behaving, but it's
  // the last line of defence before anything goes out to a real platform.
  const approved = await hasApprovedLog(post.id);
  if (!approved) {
    logger.error(`post ${post.id} is '${post.status}' but has no approval_log row with action='approved' — skipping`);
    await writeApprovalLog({
      postId: post.id,
      brandId: brand.id,
      action: "publish_failed",
      note: "blocked: missing approval_log row with action='approved'",
    }).catch((e) => logger.error("failed to write missing-approval log", { error: String(e) }));
    return;
  }

  const rate = await checkRateLimit(graph, brand, post.platform);
  if (!rate.ok) {
    logger.warn(
      `rate limit reached for brand ${brand.id} platform ${post.platform} (${rate.count}/${rate.limit}) — leaving post ${post.id} for next tick`
    );
    return;
  }

  let mediaUrls: string[];
  try {
    mediaUrls = await resolveMediaUrls(brand.id, post.media_ids);
  } catch (err) {
    logger.error(`post ${post.id}: failed to resolve media URLs`, { error: String(err) });
    return; // leave the post as-is; retried next tick, doesn't count against retry_count
  }

  try {
    await query(`update posts set status = $1 where id = $2 and brand_id = $3`, ["publishing", post.id, brand.id]);
  } catch (err) {
    logger.error(`post ${post.id}: failed to mark as publishing`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const result = await withRetry(`publish:${post.id}`, () =>
      graph.publish({ brand, platform: post.platform, caption: post.caption ?? "", mediaUrls, format: post.format })
    );

    await query(
      `update posts
       set status = $1, published_at = $2, external_post_id = $3, last_error = null
       where id = $4 and brand_id = $5`,
      ["published", deps.now().toISOString(), result.externalPostId, post.id, brand.id],
    );

    await writeApprovalLog({
      postId: post.id,
      brandId: brand.id,
      action: "published",
      after: { external_post_id: result.externalPostId, permalink: result.permalink },
    });

    const permalinkLine = result.permalink ? `\n${result.permalink}` : "";
    const env = getServerEnv();
    const live = didPublishLive(post.platform, env.GRAPH_MODE);
    const feedPlatforms = new Set(["x", "threads", "linkedin", "tiktok"]);
    const feedUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/feed${feedPlatforms.has(post.platform) ? `?platform=${post.platform}` : ""}`;
    await send(
      brand.id,
      `${publishConfirmation(post.platform, {
        live,
        feedUrl,
        externalPostId: result.externalPostId,
        permalink: result.permalink,
      })}${live && !result.permalink ? permalinkLine : ""}`,
    );
  } catch (err) {
    await handlePublishFailure(post, brand, err, deps);
  }
}

async function handlePublishFailure(
  post: PostWithBrand,
  brand: Brand,
  err: unknown,
  deps: PublishLoopDeps
): Promise<void> {
  const { sendToBrand: send } = deps;
  const message = err instanceof Error ? err.message : String(err);
  const retryCount = (post.retry_count ?? 0) + 1;
  logger.error(`publish failed for post ${post.id} (attempt ${retryCount}/${MAX_PUBLISH_ATTEMPTS})`, {
    error: message,
  });

  if (retryCount >= MAX_PUBLISH_ATTEMPTS) {
    await query(
      `update posts set status = $1, retry_count = $2, last_error = $3 where id = $4 and brand_id = $5`,
      ["failed", retryCount, message, post.id, brand.id],
    );

    await writeApprovalLog({
      postId: post.id,
      brandId: brand.id,
      action: "publish_failed",
      note: message,
    });

    const ownerSms = brandFacingPublishError(post.platform, message);
    if (ownerSms) {
      await send(brand.id, ownerSms).catch((alertErr) =>
        logger.error("failed to SMS brand of LI/TT publish failure", { error: String(alertErr) }),
      );
    }

    await send(
      operatorPhone(),
      `Publish FAILED for "${brand.name}" (${post.platform}) after ${retryCount} attempts: ${message}`
    ).catch((alertErr) => logger.error("failed to alert operator of publish failure", { error: String(alertErr) }));
    return;
  }

  // Back off before the next attempt instead of hammering every tick: 2, 4, 8, ... minutes.
  const backoffMinutes = PUBLISH_BACKOFF_BASE_MINUTES * 2 ** (retryCount - 1);
  const nextAttemptAt = new Date(deps.now().getTime() + backoffMinutes * 60_000).toISOString();
  await query(
    `update posts
     set status = $1, retry_count = $2, last_error = $3, scheduled_at = $4
     where id = $5 and brand_id = $6`,
    ["approved", retryCount, message, nextAttemptAt, post.id, brand.id],
  );
}
