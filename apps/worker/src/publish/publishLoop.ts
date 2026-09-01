import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@pulse/shared";
import type { Brand, Post } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import type { GraphAdapter } from "@pulse/graph";
import { sendToBrand } from "@pulse/gateway";
import { logger } from "../lib/logger.js";
import { withRetry } from "../lib/retry.js";
import { resolveMediaUrls } from "../lib/media.js";
import { checkRateLimit } from "./rateLimit.js";
import { hasApprovedLog } from "./assertApproved.js";
import { writeApprovalLog } from "./approvalLog.js";
import { MAX_PUBLISH_ATTEMPTS, PUBLISH_BACKOFF_BASE_MINUTES, operatorPhone } from "../config.js";

export interface PublishLoopDeps {
  supabase: SupabaseClient;
  graph: GraphAdapter;
  sendToBrand: typeof sendToBrand;
  now: () => Date;
}

export function defaultPublishLoopDeps(): PublishLoopDeps {
  return {
    supabase: serviceClient(),
    graph: getGraphAdapter(),
    sendToBrand,
    now: () => new Date(),
  };
}

type PostWithBrand = Post & { brands: Brand };

async function fetchDuePosts(supabase: SupabaseClient, now: Date): Promise<PostWithBrand[]> {
  // status in ('approved','scheduled') and (scheduled_at is null or scheduled_at <= now())
  const { data, error } = await supabase
    .from("posts")
    .select("*, brands(*)")
    .in("status", ["approved", "scheduled"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${now.toISOString()}`)
    .order("scheduled_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(`fetchDuePosts failed: ${error.message}`);
  return (data ?? []) as PostWithBrand[];
}

/** Publish loop — runs every minute from src/index.ts. */
export async function runPublishLoop(deps: PublishLoopDeps = defaultPublishLoopDeps()): Promise<void> {
  const { supabase, now } = deps;

  let due: PostWithBrand[];
  try {
    due = await fetchDuePosts(supabase, now());
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
  const { supabase, graph, sendToBrand: send } = deps;
  const brand = post.brands;
  if (!brand) {
    logger.error(`post ${post.id} has no linked brand — skipping`);
    return;
  }

  // Approval is absolute. This should never trip if the dashboard is behaving, but it's
  // the last line of defence before anything goes out to a real platform.
  const approved = await hasApprovedLog(supabase, post.id);
  if (!approved) {
    logger.error(`post ${post.id} is '${post.status}' but has no approval_log row with action='approved' — skipping`);
    await writeApprovalLog(supabase, {
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
    mediaUrls = await resolveMediaUrls(post.media_ids);
  } catch (err) {
    logger.error(`post ${post.id}: failed to resolve media URLs`, { error: String(err) });
    return; // leave the post as-is; retried next tick, doesn't count against retry_count
  }

  const { error: markErr } = await supabase.from("posts").update({ status: "publishing" }).eq("id", post.id);
  if (markErr) {
    logger.error(`post ${post.id}: failed to mark as publishing`, { error: markErr.message });
    return;
  }

  try {
    const result = await withRetry(`publish:${post.id}`, () =>
      graph.publish({ brand, platform: post.platform, caption: post.caption ?? "", mediaUrls })
    );

    const { error: updateErr } = await supabase
      .from("posts")
      .update({
        status: "published",
        published_at: deps.now().toISOString(),
        external_post_id: result.externalPostId,
        last_error: null,
      })
      .eq("id", post.id);
    if (updateErr) throw new Error(`failed to persist published state: ${updateErr.message}`);

    await writeApprovalLog(supabase, {
      postId: post.id,
      brandId: brand.id,
      action: "published",
      after: { external_post_id: result.externalPostId, permalink: result.permalink },
    });

    const permalinkLine = result.permalink ? `\n${result.permalink}` : "";
    await send(brand.id, `Posted to ${post.platform}! ✅${permalinkLine}`);
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
  const { supabase, sendToBrand: send } = deps;
  const message = err instanceof Error ? err.message : String(err);
  const retryCount = (post.retry_count ?? 0) + 1;
  logger.error(`publish failed for post ${post.id} (attempt ${retryCount}/${MAX_PUBLISH_ATTEMPTS})`, {
    error: message,
  });

  if (retryCount >= MAX_PUBLISH_ATTEMPTS) {
    await supabase
      .from("posts")
      .update({ status: "failed", retry_count: retryCount, last_error: message })
      .eq("id", post.id);

    await writeApprovalLog(supabase, {
      postId: post.id,
      brandId: brand.id,
      action: "publish_failed",
      note: message,
    });

    await send(
      operatorPhone(),
      `Publish FAILED for "${brand.name}" (${post.platform}) after ${retryCount} attempts: ${message}`
    ).catch((alertErr) => logger.error("failed to alert operator of publish failure", { error: String(alertErr) }));
    return;
  }

  // Back off before the next attempt instead of hammering every tick: 2, 4, 8, ... minutes.
  const backoffMinutes = PUBLISH_BACKOFF_BASE_MINUTES * 2 ** (retryCount - 1);
  const nextAttemptAt = new Date(deps.now().getTime() + backoffMinutes * 60_000).toISOString();
  await supabase
    .from("posts")
    .update({ status: "approved", retry_count: retryCount, last_error: message, scheduled_at: nextAttemptAt })
    .eq("id", post.id);
}
