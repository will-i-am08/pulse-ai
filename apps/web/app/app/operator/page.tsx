import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { loadOverviewMetrics } from '@/lib/metrics/overview';
import type { MetricsTimeframe } from '@/lib/metrics/types';
import MetricsChart from './components/MetricsChart';
import TimeframeToggle from './components/TimeframeToggle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview · Operator | Kip' };

const RANGES: MetricsTimeframe[] = ['7d', '30d', '90d', '12m', 'all'];

function parseRange(raw: string | string[] | undefined): MetricsTimeframe {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (RANGES as string[]).includes(v) ? (v as MetricsTimeframe) : '30d';
}

function money(n: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function OperatorOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.is_admin) redirect('/app');

  const { range: rangeParam } = await searchParams;
  const timeframe = parseRange(rangeParam);
  const metrics = await loadOverviewMetrics(timeframe);

  return (
    <section className="stage">
      <div className="page">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h1 className="page-h1">Overview</h1>
          <TimeframeToggle current={timeframe} />
        </div>
        <p className="lead">
          Platform metrics for Kip. Revenue is estimated from plan facts until Stripe is connected.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginTop: 24,
          }}
        >
          <MetricCard
            label="Live users"
            value={String(metrics.users.totalLive)}
            hint={`${metrics.users.newInRange} new in range`}
          />
          <MetricCard
            label="Active brands"
            value={String(metrics.brands.active)}
            hint={`${metrics.brands.paused} paused`}
          />
          <MetricCard label="Est. MRR" value={money(metrics.revenue.mrr)} hint="From paid plan facts" />
          <MetricCard label="Page views" value={String(metrics.visits.total)} hint="In selected range" />
        </div>

        <h2 className="page-h1" style={{ marginTop: 40, fontSize: 22 }}>
          Signups
        </h2>
        <p className="lead">New user accounts created.</p>
        <MetricsChart data={metrics.users.series} emptyLabel="No signups in this range yet." />

        <h2 className="page-h1" style={{ marginTop: 40, fontSize: 22 }}>
          Revenue (MRR)
        </h2>
        <p className="lead">Estimated monthly recurring revenue from brands with submitted payment.</p>
        <MetricsChart
          data={metrics.revenue.series}
          valuePrefix="$"
          emptyLabel="No paid brands in this range yet."
        />

        <h2 className="page-h1" style={{ marginTop: 40, fontSize: 22 }}>
          Site visits
        </h2>
        <p className="lead">First-party page views across marketing and app routes.</p>
        <MetricsChart data={metrics.visits.series} emptyLabel="No page views recorded yet." />
      </div>
    </section>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="brand-card" style={{ margin: 0 }}>
      <p className="empty" style={{ margin: 0 }}>
        {label}
      </p>
      <strong style={{ fontSize: 28, display: 'block', marginTop: 4 }}>{value}</strong>
      <p className="empty" style={{ margin: '4px 0 0' }}>
        {hint}
      </p>
    </div>
  );
}
