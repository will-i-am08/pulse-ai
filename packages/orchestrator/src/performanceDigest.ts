import { query, type Brand, type Platform } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import { analyzePerformance, type PostPerf } from "./insights.js";

/**
 * Build the closed-loop performance digest for a brand (same text as the old
 * Discord !digest). Used by the weekly SMS trigger and natural-language asks
 * like "how did we do this week?".
 */
export async function buildPerformanceDigest(brand: Brand): Promise<string> {
  const rows = await query<{
    caption: string | null;
    platform: Platform;
    scheduled_at: string | null;
    external_post_id: string | null;
    engagement: Record<string, number>;
    pillar_name: string | null;
  }>(
    `select p.caption, p.platform, p.scheduled_at, p.external_post_id, p.engagement, pl.name as pillar_name
       from posts p left join pillars pl on pl.id = p.pillar_id
      where p.brand_id = $1 and p.status = 'published'
      order by p.published_at desc nulls last limit 30`,
    [brand.id],
  );

  const perf: PostPerf[] = [];
  for (const r of rows) {
    let engagement = r.engagement && Object.keys(r.engagement).length > 0 ? r.engagement : {};
    if (Object.keys(engagement).length === 0 && r.external_post_id) {
      try {
        engagement = await getGraphAdapter().fetchEngagement(brand, r.external_post_id, r.platform);
        await query(`update posts set engagement = $1::jsonb where external_post_id = $2`, [
          JSON.stringify(engagement),
          r.external_post_id,
        ]);
      } catch {
        /* leave empty */
      }
    }
    perf.push({
      caption: r.caption,
      pillar_name: r.pillar_name,
      platform: r.platform,
      scheduled_at: r.scheduled_at,
      engagement,
    });
  }
  return analyzePerformance(perf).text;
}
