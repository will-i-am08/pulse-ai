import 'server-only';
import { query, queryOne } from '@pulse/shared';
import { bucketKey, fillSeries, type MetricsRange, type SeriesPoint, type VisitsProvider } from './types';

/** First-party pageview store. Swap or dual-write when an external analytics tool is added. */
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
