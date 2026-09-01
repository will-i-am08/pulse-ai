import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, ProactiveTrigger, Post } from "@pulse/shared";
import type { GraphAdapter } from "@pulse/graph";
import { logger } from "../lib/logger.js";
import { withRetry } from "../lib/retry.js";

export interface ReportDeps {
  supabase: SupabaseClient;
  graph: GraphAdapter;
  sendToBrand: (brandId: string, body: string) => Promise<void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
}

async function getRecentPublishedPosts(supabase: SupabaseClient, brandId: string, since: Date): Promise<Post[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("brand_id", brandId)
    .eq("status", "published")
    .gte("published_at", since.toISOString());
  if (error) throw new Error(`getRecentPublishedPosts failed: ${error.message}`);
  return (data ?? []) as Post[];
}

/**
 * `strategy_notes` has no dedicated free-text log column, so the rolling performance
 * summary is folded into `content_mix.performance_notes` (a jsonb array, capped at the
 * last 12 entries) rather than `voice_notes`, which is reserved for caption-style notes.
 */
async function appendPerformanceNote(supabase: SupabaseClient, brandId: string, line: string): Promise<void> {
  const { data, error } = await supabase
    .from("strategy_notes")
    .select("content_mix")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw new Error(`appendPerformanceNote read failed: ${error.message}`);

  const contentMix = (data?.content_mix ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(contentMix.performance_notes)
    ? (contentMix.performance_notes as string[])
    : [];
  const performance_notes = [...existing, line].slice(-12);

  const { error: upsertError } = await supabase.from("strategy_notes").upsert(
    { brand_id: brandId, content_mix: { ...contentMix, performance_notes }, last_updated: new Date().toISOString() },
    { onConflict: "brand_id" }
  );
  if (upsertError) throw new Error(`appendPerformanceNote write failed: ${upsertError.message}`);
}

/**
 * `report` trigger: weekly performance summary. Pulls engagement for posts published in
 * the last 7 days, folds a 1-2 line summary into strategy_notes, and texts the client a
 * plain-text summary.
 */
export async function runReport(brand: Brand, trigger: ProactiveTrigger, deps: ReportDeps): Promise<void> {
  const since = new Date(deps.now().getTime() - 7 * 24 * 60 * 60 * 1000);
  const posts = await getRecentPublishedPosts(deps.supabase, brand.id, since);

  if (posts.length === 0) {
    logger.info(`no published posts in the last 7 days for brand ${brand.id} — skipping report`);
    await deps.markSent(trigger.id);
    return;
  }

  let totalLikes = 0;
  let totalComments = 0;
  let totalReach = 0;

  for (const post of posts) {
    if (!post.external_post_id) continue;
    try {
      const engagement = await withRetry(`report:engagement:${post.id}`, () =>
        deps.graph.fetchEngagement(brand, post.external_post_id as string, post.platform)
      );
      totalLikes += engagement.likes ?? 0;
      totalComments += engagement.comments ?? 0;
      totalReach += engagement.reach ?? 0;
    } catch (err) {
      logger.error(`report: failed to fetch engagement for post ${post.id}`, { error: String(err) });
    }
  }

  const summaryLine = `Week of ${since.toISOString().slice(0, 10)}: ${posts.length} posts, ${totalLikes} likes, ${totalComments} comments, ~${totalReach} reach.`;
  await appendPerformanceNote(deps.supabase, brand.id, summaryLine);

  const clientSummary =
    `Weekly performance: ${posts.length} post${posts.length === 1 ? "" : "s"} published, ` +
    `${totalLikes} likes, ${totalComments} comments, ~${totalReach} reach.`;
  await deps.sendToBrand(brand.id, clientSummary);
  await deps.markSent(trigger.id);
}
