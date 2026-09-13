import 'server-only';
import { query, queryOne } from '@pulse/shared';
import {
  fetchVercelLandingPageviews,
  fetchVercelVisitSeries,
  fetchVercelVisitTotals,
  vercelAnalyticsConfigured,
  type AnalyticsSource,
} from './vercel-analytics';
import { bucketKey, fillSeries, type MetricsRange, type SeriesPoint, type VisitsProvider } from './types';

export interface VisitsBreakdown {
  pageviews: number;
  visitors: number;
  landingPageviews: number;
  series: SeriesPoint[];
  visitorsSeries: SeriesPoint[];
  source: AnalyticsSource;
}

/** First-party pageview store (page_views table + beacon). */
export class PageViewsVisitsProvider implements VisitsProvider {
  async total(range: MetricsRange): Promise<number> {
    try {
      const row = await queryOne<{ n: number }>(
        `select count(*)::int as n from page_views
          where created_at >= $1 and created_at <= $2`,
        [range.from.toISOString(), range.to.toISOString()],
      );
      return row?.n ?? 0;
    } catch (err) {
      console.error('visits.total failed', err);
      return 0;
    }
  }

  async series(range: MetricsRange): Promise<SeriesPoint[]> {
    try {
      const trunc =
        range.granularity === 'day' ? 'day' : range.granularity === 'week' ? 'week' : 'month';
      const rows = await query<{ bucket: string; n: number }>(
        `select date_trunc($3, created_at at time zone 'UTC')::date::text as bucket,
                count(*)::int as n
           from page_views
          where created_at >= $1 and created_at <= $2
          group by 1
          order by 1`,
        [range.from.toISOString(), range.to.toISOString(), trunc],
      );
      const points = rows.map((r) => ({
        bucket: bucketKey(new Date(`${r.bucket}T00:00:00.000Z`), range.granularity),
        value: r.n,
      }));
      return fillSeries(points, range);
    } catch (err) {
      console.error('visits.series failed', err);
      return fillSeries([], range);
    }
  }
}

async function firstPartyVisitors(range: MetricsRange): Promise<number> {
  try {
    const row = await queryOne<{ n: number }>(
      `select count(distinct coalesce(session_id, id::text))::int as n
         from page_views
        where created_at >= $1 and created_at <= $2`,
      [range.from.toISOString(), range.to.toISOString()],
    );
    return row?.n ?? 0;
  } catch (err) {
    console.error('visits.visitors failed', err);
    return 0;
  }
}

async function firstPartyLandingPageviews(range: MetricsRange): Promise<number> {
  try {
    const row = await queryOne<{ n: number }>(
      `select count(*)::int as n from page_views
        where created_at >= $1 and created_at <= $2
          and (path = '/' or path = '')`,
      [range.from.toISOString(), range.to.toISOString()],
    );
    return row?.n ?? 0;
  } catch (err) {
    console.error('visits.landing failed', err);
    return 0;
  }
}

async function firstPartyVisitorsSeries(range: MetricsRange): Promise<SeriesPoint[]> {
  try {
    const trunc =
      range.granularity === 'day' ? 'day' : range.granularity === 'week' ? 'week' : 'month';
    const rows = await query<{ bucket: string; n: number }>(
      `select date_trunc($3, created_at at time zone 'UTC')::date::text as bucket,
              count(distinct coalesce(session_id, id::text))::int as n
         from page_views
        where created_at >= $1 and created_at <= $2
        group by 1
        order by 1`,
      [range.from.toISOString(), range.to.toISOString(), trunc],
    );
    const points = rows.map((r) => ({
      bucket: bucketKey(new Date(`${r.bucket}T00:00:00.000Z`), range.granularity),
      value: r.n,
    }));
    return fillSeries(points, range);
  } catch (err) {
    console.error('visits.visitorsSeries failed', err);
    return fillSeries([], range);
  }
}

/**
 * Prefer Vercel Web Analytics when a token is configured; otherwise use first-party
 * page_views (beacon). Operator Overview always gets a usable breakdown either way.
 */
export async function loadVisitsBreakdown(range: MetricsRange): Promise<VisitsBreakdown> {
  const firstParty = new PageViewsVisitsProvider();

  if (vercelAnalyticsConfigured()) {
    try {
      const [totals, series, landing] = await Promise.all([
        fetchVercelVisitTotals(range),
        fetchVercelVisitSeries(range),
        fetchVercelLandingPageviews(range),
      ]);
      if (totals && series) {
        return {
          pageviews: totals.pageviews,
          visitors: totals.visitors,
          landingPageviews: landing ?? 0,
          series: series.pageviews,
          visitorsSeries: series.visitors,
          source: 'vercel',
        };
      }
    } catch (err) {
      console.error('Vercel analytics load failed; falling back to first-party', err);
    }
  }

  const [pageviews, visitors, landingPageviews, series, visitorsSeries] = await Promise.all([
    firstParty.total(range),
    firstPartyVisitors(range),
    firstPartyLandingPageviews(range),
    firstParty.series(range),
    firstPartyVisitorsSeries(range),
  ]);

  return {
    pageviews,
    visitors,
    landingPageviews,
    series,
    visitorsSeries,
    source: 'first_party',
  };
}

export function getVisitsProvider(): VisitsProvider {
  return new PageViewsVisitsProvider();
}

/** Record a page view (best-effort; never throws to callers). */
export async function recordPageView(input: {
  path: string;
  sessionId?: string | null;
  userId?: string | null;
}): Promise<void> {
  const path = input.path.slice(0, 500);
  if (!path.startsWith('/')) return;
  try {
    await query(`insert into page_views (path, session_id, user_id) values ($1, $2, $3)`, [
      path,
      input.sessionId ?? null,
      input.userId ?? null,
    ]);
  } catch (err) {
    console.error('recordPageView failed', err);
  }
}
