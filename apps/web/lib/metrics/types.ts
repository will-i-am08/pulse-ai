/** Shared shapes for operator platform metrics. */

export type MetricsGranularity = 'day' | 'week' | 'month';

export type MetricsTimeframe = '7d' | '30d' | '90d' | '12m' | 'all';

export interface MetricsRange {
  from: Date;
  to: Date;
  granularity: MetricsGranularity;
}

export interface SeriesPoint {
  bucket: string;
  value: number;
}

export interface RevenueProvider {
  mrrSnapshot(): Promise<number>;
  mrrSeries(range: MetricsRange): Promise<SeriesPoint[]>;
}

export interface VisitsProvider {
  total(range: MetricsRange): Promise<number>;
  series(range: MetricsRange): Promise<SeriesPoint[]>;
}

export function resolveRange(timeframe: MetricsTimeframe, now = new Date()): MetricsRange {
  const to = now;
  const from = new Date(now);
  let granularity: MetricsGranularity = 'day';

  switch (timeframe) {
    case '7d':
      from.setUTCDate(from.getUTCDate() - 7);
      granularity = 'day';
      break;
    case '30d':
      from.setUTCDate(from.getUTCDate() - 30);
      granularity = 'day';
      break;
    case '90d':
      from.setUTCDate(from.getUTCDate() - 90);
      granularity = 'week';
      break;
    case '12m':
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      granularity = 'week';
      break;
    case 'all':
      from.setUTCFullYear(2018, 0, 1);
      granularity = 'month';
      break;
  }

  return { from, to, granularity };
}

export function timeframeLabel(tf: MetricsTimeframe): string {
  switch (tf) {
    case '7d':
      return '7 days';
    case '30d':
      return '30 days';
    case '90d':
      return '90 days';
    case '12m':
      return '12 months';
    case 'all':
      return 'All time';
  }
}

/** Truncate a Date to the range granularity as an ISO date string (UTC). */
export function bucketKey(d: Date, granularity: MetricsGranularity): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (granularity === 'day') return `${y}-${m}-${day}`;
  if (granularity === 'month') return `${y}-${m}-01`;
  const tmp = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dow = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() - (dow - 1));
  return `${tmp.getUTCFullYear()}-${String(tmp.getUTCMonth() + 1).padStart(2, '0')}-${String(tmp.getUTCDate()).padStart(2, '0')}`;
}

/** Fill missing buckets with zeros between from and to. */
export function fillSeries(points: SeriesPoint[], range: MetricsRange): SeriesPoint[] {
  const map = new Map(points.map((p) => [p.bucket, p.value]));
  const out: SeriesPoint[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    const key = bucketKey(cursor, range.granularity);
    if (!out.length || out[out.length - 1]!.bucket !== key) {
      out.push({ bucket: key, value: map.get(key) ?? 0 });
    }
    if (range.granularity === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (range.granularity === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}
