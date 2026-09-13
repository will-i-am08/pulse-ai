'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { query, queryOne, type Brand, type BrandPlanFacts, type BusinessFacts } from '@pulse/shared';
import { kickOffOnboardingAfterPayment } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';
import { currentUser } from '@/lib/auth/current-user';

export type PlanTier = 'pro' | 'max';
export type PlanInterval = 'month' | 'year';

function parsePlan(formData: FormData): BrandPlanFacts | null {
  const tierRaw = String(formData.get('tier') ?? '').toLowerCase();
  const intervalRaw = String(formData.get('interval') ?? '').toLowerCase();
  const tier: PlanTier | null = tierRaw === 'pro' || tierRaw === 'max' ? tierRaw : null;
  const interval: PlanInterval | null =
    intervalRaw === 'month' || intervalRaw === 'year'
      ? intervalRaw
      : intervalRaw === 'monthly'
        ? 'month'
        : intervalRaw === 'annual' || intervalRaw === 'yearly'
          ? 'year'
          : null;
  if (!tier || !interval) return null;
  return { tier, interval, selected_at: new Date().toISOString() };
}

async function brandForUser(userId: string): Promise<Brand | null> {
  return queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
}

/**
 * Payment UI submit — no Stripe. Persists the chosen plan, marks payment as
 * submitted on the brand, and kicks off SMS onboarding. Does not gate /app.
 */
export async function submitPaymentAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const plan = parsePlan(formData);
  if (!plan) redirect('/payment?error=plan');

  const brand = await brandForUser(user.id);
  if (!brand) redirect('/payment?error=nobrand');

  const facts: BusinessFacts = { ...(brand.facts ?? {}) };
  const alreadySubmitted = Boolean(facts.payment?.submitted_at);
  facts.plan = plan;
  facts.plan_preference = plan;
  facts.payment = {
    ...(facts.payment ?? {}),
    status: 'submitted',
    submitted_at: facts.payment?.submitted_at ?? new Date().toISOString(),
  };

  await query('update brands set facts = $1::jsonb where id = $2', [
    JSON.stringify(facts),
    brand.id,
  ]);

  // Kick off SMS setup only once (first successful UI submit while still pending).
  const status = brand.onboarding_state?.status ?? 'none';
  if (!alreadySubmitted && (status === 'none' || status === 'pending')) {
    try {
      const greeting = await kickOffOnboardingAfterPayment(brand.id);
      await sendToBrand(brand.id, greeting);
    } catch (err) {
      console.error('[payment] kickoff failed:', err instanceof Error ? err.message : err);
      redirect('/payment?error=kickoff');
    }
  }

  redirect('/check-messages');
}
