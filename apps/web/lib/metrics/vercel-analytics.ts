import 'server-only';

import { fillSeries, type MetricsRange, type SeriesPoint } from './types';

/**
 * Server-side client for Vercel Web Analytics (production data).
 *
 * Requires `VERCEL_API_TOKEN` (or `VERCEL_TOKEN`). Project/team IDs default to
 * the pulse-ai Vercel project; `VERCEL_PROJECT_ID` is also injected on Vercel.
 *
 * @see https://vercel.com/docs/analytics/web-analytics-api
 */

const DEFAULT_PROJECT_ID = 'prj_WxDIlE2x3TxZCFu9KRY28lLqeqdI';
const DEFAULT_TEAM_ID = 'team_8W3bM4bNRwWeqt4WaVCYFFyQ';

export type AnalyticsSource = 'vercel' | 'first_party';

export interface VisitTotals {
  pageviews: number;
  visitors: number;
}

function analyticsToken(): string | null {
  return process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN || null;
}

function projectId(): string {
  return (
    process.env.VERCEL_ANALYTICS_PROJECT_ID ||
    process.env.VERCEL_PROJECT_ID ||
    DEFAULT_PROJECT_ID
  );
}

function teamId(): string | null {
  return process.env.VERCEL_ANALYTICS_TEAM_ID || process.env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
}

/** True when we can call the Web Analytics API. */
export function vercelAnalyticsConfigured(): boolean {
  return Boolean(analyticsToken());
}

function granularityToBy(granularity: MetricsRange['granularity']): 'day' | 'week' | 'month' {
  if (granularity === 'week') return 'week';
  if (granularity === 'month') return 'month';
  return 'day';
}

async function vercelQuery<T>(
  path: 'visits/count' | 'visits/aggregate',
  params: Record<string, string | undefined>,
): Promise<T | null> {
  const token = analyticsToken();
  if (!token) return null;

  const url = new URL(`https://api.vercel.com/v1/web-analytics/${path}`);
  url.searchParams.set('projectId', projectId());
  const team = teamId();
  if (team) url.searchParams.set('teamId', team);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Vercel Web Analytics query failed', res.status, body.slice(0, 300));
    return null;
  }
  return (await res.json()) as T;
}

/** Total pageviews + unique visitors for a range. */
export async function fetchVercelVisitTotals(range: MetricsRange): Promise<VisitTotals | null> {
  const json = await vercelQuery<{
    data?: { pageviews?: number; visitors?: number; total?: number };
  }>('visits/count', {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  });
  if (!json?.data) return null;
  return {
    pageviews: Number(json.data.pageviews ?? json.data.total ?? 0),
    visitors: Number(json.data.visitors ?? 0),
  };
}

/** Landing-page pageviews only (`/` path). */
export async function fetchVercelLandingPageviews(range: MetricsRange): Promise<number | null> {
  const json = await vercelQuery<{
    data?: { pageviews?: number; visitors?: number; total?: number };
  }>('visits/count', {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    filter: "path eq '/'",
  });
  if (!json?.data) return null;
  return Number(json.data.pageviews ?? json.data.total ?? 0);
}

/** Time series of pageviews / visitors for the range granularity. */
export async function fetchVercelVisitSeries(range: MetricsRange): Promise<{
  pageviews: SeriesPoint[];
  visitors: SeriesPoint[];
} | null> {
  const by = granularityToBy(range.granularity);
  const json = await vercelQuery<{
    data?: Array<{
      date?: string;
      day?: string;
      week?: string;
      month?: string;
      timestamp?: string;
      pageviews?: number;
      visitors?: number;
      total?: number;
    }>;
  }>('visits/aggregate', {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    by,
  });
  if (!json?.data) return null;

  const pagePoints: SeriesPoint[] = [];
  const visitorPoints: SeriesPoint[] = [];
  for (const row of json.data) {
    const raw = row.date ?? row.day ?? row.week ?? row.month ?? row.timestamp;
    if (!raw) continue;
    const bucket = String(raw).slice(0, 10);
    pagePoints.push({ bucket, value: Number(row.pageviews ?? row.total ?? 0) });
    visitorPoints.push({ bucket, value: Number(row.visitors ?? 0) });
  }

  return {
    pageviews: fillSeries(pagePoints, range),
    visitors: fillSeries(visitorPoints, range),
  };
}
