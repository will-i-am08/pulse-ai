import 'server-only';
import { query } from '@pulse/shared';
import { countsTowardMrr, type BrandPlanFacts, type BusinessFacts } from '@pulse/shared';
import { fillSeries, type MetricsRange, type RevenueProvider, type SeriesPoint } from './types';

/** Monthly AUD MRR from a plan choice (landing-page list prices). */
export function planMrrAud(plan: BrandPlanFacts | undefined | null): number {
  if (!plan) return 0;
  if (plan.tier === 'pro') return plan.interval === 'year' ? 63 : 79;
  if (plan.tier === 'max') return plan.interval === 'year' ? 119 : 149;
  return 0;
}

function isPaid(facts: BusinessFacts | null | undefined): boolean {
  return countsTowardMrr(facts);
}

function effectivePlan(facts: BusinessFacts | null | undefined): BrandPlanFacts | null {
  if (!facts || !isPaid(facts)) return null;
  return facts.plan ?? facts.plan_preference ?? null;
}

type BrandRow = { id: string; created_at: string; facts: BusinessFacts | null };

function bucketEnd(bucketStart: Date, range: MetricsRange): Date {
  const end = new Date(bucketStart);
  if (range.granularity === 'day') end.setUTCDate(end.getUTCDate() + 1);
  else if (range.granularity === 'week') end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return new Date(end.getTime() - 1);
}

/**
 * Estimated MRR from brand plan/payment facts. Ignore unpaid brands.
 * Swap for {@link StripeRevenueProvider} once Stripe is wired.
 */
export class PlanFactsRevenueProvider implements RevenueProvider {
  async mrrSnapshot(): Promise<number> {
    const rows = await query<BrandRow>(`select id, created_at, facts from brands`);
    return rows.reduce((sum, b) => sum + planMrrAud(effectivePlan(b.facts)), 0);
  }

  async mrrSeries(range: MetricsRange): Promise<SeriesPoint[]> {
    const rows = await query<BrandRow>(
      `select id, created_at, facts from brands where created_at <= $1`,
      [range.to.toISOString()],
    );
    const paid = rows
      .map((b) => ({ created: new Date(b.created_at), mrr: planMrrAud(effectivePlan(b.facts)) }))
      .filter((b) => b.mrr > 0);

    return fillSeries([], range).map((p) => {
      const start = new Date(`${p.bucket}T00:00:00.000Z`);
      const end = bucketEnd(start, range);
      let total = 0;
      for (const b of paid) {
        if (b.created <= end) total += b.mrr;
      }
      return { bucket: p.bucket, value: total };
    });
  }
}

/**
 * Stripe-backed revenue. Returns zeros until STRIPE_SECRET_KEY is set and
 * METRICS_REVENUE_PROVIDER=stripe. Overview keeps calling the same interface.
 */
export class StripeRevenueProvider implements RevenueProvider {
  async mrrSnapshot(): Promise<number> {
    if (!process.env.STRIPE_SECRET_KEY) return 0;
    // TODO: list active subscriptions and sum recurring amounts.
    return 0;
  }

  async mrrSeries(_range: MetricsRange): Promise<SeriesPoint[]> {
    if (!process.env.STRIPE_SECRET_KEY) return [];
    return [];
  }
}

export function getRevenueProvider(): RevenueProvider {
  if (process.env.STRIPE_SECRET_KEY && process.env.METRICS_REVENUE_PROVIDER === 'stripe') {
    return new StripeRevenueProvider();
  }
  return new PlanFactsRevenueProvider();
}
