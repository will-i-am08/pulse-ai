import { query, queryOne } from "@pulse/shared";
import type { Brand, ProactiveTrigger, Post } from "@pulse/shared";
import type { GraphAdapter } from "@pulse/graph";
import { logger } from "../lib/logger.js";
import { withRetry } from "../lib/retry.js";

export interface ReportDeps {
  graph: GraphAdapter;
  sendToBrand: (brandId: string, body: string) => Promise<boolean | void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
}

async function getRecentPublishedPosts(brandId: string, since: Date): Promise<Post[]> {
  return query<Post>(
    `select * from posts
     where brand_id = $1 and status = $2 and published_at >= $3`,
    [brandId, "published", since.toISOString()],
  );
}

/**
 * `strategy_notes` has no dedicated free-text log column, so the rolling performance
 * summary is folded into `content_mix.performance_notes` (a jsonb array, capped at the
 * last 12 entries) rather than `voice_notes`, which is reserved for caption-style notes.
 */
async function appendPerformanceNote(brandId: string, line: string): Promise<void> {
  const existingRow = await queryOne<{ content_mix: Record<string, unknown> }>(
    `select content_mix from strategy_notes where brand_id = $1`,
    [brandId],
  );

  const contentMix = existingRow?.content_mix ?? {};
  const existingNotes = Array.isArray((contentMix as Record<string, unknown>).performance_notes)
    ? ((contentMix as Record<string, unknown>).performance_notes as string[])
    : [];
  const performance_notes = [...existingNotes, line].slice(-12);
  const nextContentMix = { ...contentMix, performance_notes };

  await query(
    `insert into strategy_notes (brand_id, content_mix, last_updated)
     values ($1, $2::jsonb, $3)
     on conflict (brand_id) do update
       set content_mix = excluded.content_mix, last_updated = excluded.last_updated`,
    [brandId, JSON.stringify(nextContentMix), new Date().toISOString()],
  );
}

/**
 * `report` trigger: weekly performance summary. Pulls engagement for posts published in
 * the last 7 days, folds a 1-2 line summary into strategy_notes, and texts the client a
 * plain-text summary.
 */
export async function runReport(brand: Brand, trigger: ProactiveTrigger, deps: ReportDeps): Promise<void> {
  const since = new Date(deps.now().getTime() - 7 * 24 * 60 * 60 * 1000);
  const posts = await getRecentPublishedPosts(brand.id, since);

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
  await appendPerformanceNote(brand.id, summaryLine);

  const clientSummary =
    `Weekly performance: ${posts.length} post${posts.length === 1 ? "" : "s"} published, ` +
    `${totalLikes} likes, ${totalComments} comments, ~${totalReach} reach.`;
  await deps.sendToBrand(brand.id, clientSummary);
  await deps.markSent(trigger.id);
}
