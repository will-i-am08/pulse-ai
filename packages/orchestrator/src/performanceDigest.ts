import {
  query,
  type Brand,
  type Platform,
  type PostFormat,
  type AdCampaignMetrics,
} from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import {
  analyzePerformance,
  aggregateAdMetrics,
  type PostPerf,
  type PaidDigestMetrics,
  type PerformanceAnalysis,
  type PerfSuggestion,
} from "./insights.js";
import { isAdsEnabled, isAdsConnected, savePerfPending } from "./performanceActions.js";

/**
 * Build the closed-loop performance digest for a brand.
 * Used by the weekly SMS trigger and natural-language asks like
 * "how did we do this week?".
 */
export async function buildPerformanceAnalysis(brand: Brand): Promise<PerformanceAnalysis> {
  const rows = await query<{
    id: string;
    caption: string | null;
    platform: Platform;
    format: PostFormat | null;
    scheduled_at: string | null;
    external_post_id: string | null;
    engagement: Record<string, number>;
    pillar_name: string | null;
    pillar_id: string | null;
  }>(
    `select p.id, p.caption, p.platform, p.format, p.scheduled_at, p.external_post_id, p.engagement,
            pl.name as pillar_name, p.pillar_id
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
      id: r.id,
      caption: r.caption,
      pillar_name: r.pillar_name,
      pillar_id: r.pillar_id,
      platform: r.platform,
      format: r.format,
      scheduled_at: r.scheduled_at,
      engagement,
    });
  }

  const paid = await fetchPaidDigestMetrics(brand);
  const analysis = analyzePerformance(perf, { paid });

  if (analysis.suggestion) {
    await savePerfPending(brand, analysis.suggestion);
  }

  return analysis;
}

/** SMS text for weekly / on-demand digest. Persists pending suggestion when present. */
export async function buildPerformanceDigest(brand: Brand): Promise<string> {
  const analysis = await buildPerformanceAnalysis(brand);
  return analysis.text;
}

/**
 * Phase E4 + F5: join paid metrics when ads are enabled + connected.
 * Syncs Marketing API insights when possible, then aggregates stored metrics.
 */
export async function fetchPaidDigestMetrics(brand: Brand): Promise<PaidDigestMetrics | null> {
  if (!isAdsEnabled(brand)) return null;
  if (!isAdsConnected(brand)) return null;
  try {
    const { syncAdPerformance } = await import("./adSpend.js");
    await syncAdPerformance(brand).catch(() => undefined);
    const rows = await query<{ metrics: AdCampaignMetrics }>(
      `select metrics from ad_campaigns
        where brand_id = $1
          and status in ('active','paused','done')
          and updated_at > now() - interval '14 days'
        order by updated_at desc
        limit 20`,
      [brand.id],
    );
    return aggregateAdMetrics(rows.map((r) => r.metrics ?? {}));
  } catch {
    return null;
  }
}

export type { PerformanceAnalysis, PerfSuggestion, PaidDigestMetrics };
