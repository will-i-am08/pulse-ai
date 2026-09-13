import 'server-only';
import { query, queryOne } from '@pulse/shared';
import { getRevenueProvider } from './revenue';
import { fillSeries, resolveRange, type MetricsTimeframe, type SeriesPoint } from './types';
import { loadVisitsBreakdown, type VisitsBreakdown } from './visits';

export interface OverviewMetrics {
  timeframe: MetricsTimeframe;
  users: {
    totalLive: number;
    newInRange: number;
    series: SeriesPoint[];
  };
  brands: {
    active: number;
    paused: number;
  };
  revenue: {
    mrr: number;
    series: SeriesPoint[];
  };
  visits: VisitsBreakdown;
}

export async function loadOverviewMetrics(timeframe: MetricsTimeframe): Promise<OverviewMetrics> {
  const range = resolveRange(timeframe);
  const revenue = getRevenueProvider();

  const [liveUsers, newUsers, userRows, brandCounts, mrr, mrrSeries, visits] = await Promise.all([
    queryOne<{ n: number }>(`select count(*)::int as n from users where deleted_at is null`),
    queryOne<{ n: number }>(
      `select count(*)::int as n from users
        where created_at >= $1 and created_at <= $2`,
      [range.from.toISOString(), range.to.toISOString()],
    ),
    query<{ bucket: string; n: number }>(
      `select date_trunc($3, created_at at time zone 'UTC')::date::text as bucket,
              count(*)::int as n
         from users
        where created_at >= $1 and created_at <= $2
        group by 1
        order by 1`,
      [range.from.toISOString(), range.to.toISOString(), range.granularity],
    ),
    queryOne<{ active: number; paused: number }>(
      `select
         count(*) filter (where status = 'active')::int as active,
         count(*) filter (where status = 'paused')::int as paused
       from brands`,
    ),
    revenue.mrrSnapshot(),
    revenue.mrrSeries(range),
    loadVisitsBreakdown(range),
  ]);

  const userSeries = fillSeries(
    userRows.map((r) => ({ bucket: r.bucket.slice(0, 10), value: r.n })),
    range,
  );

  return {
    timeframe,
    users: {
      totalLive: liveUsers?.n ?? 0,
      newInRange: newUsers?.n ?? 0,
      series: userSeries,
    },
    brands: {
      active: brandCounts?.active ?? 0,
      paused: brandCounts?.paused ?? 0,
    },
    revenue: {
      mrr,
      series: mrrSeries,
    },
    visits,
  };
}
