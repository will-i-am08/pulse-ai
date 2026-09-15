'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import {
  appBaseUrl,
  hasPaidAccess,
  queryOne,
  stripePriceIdForPlan,
  type Brand,
  type BrandPlanFacts,
} from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { requireStripePriceCatalog } from '@/lib/billing/catalog';
import { stripeConfigured, getStripe } from '@/lib/stripe';

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
 * Create a hosted Stripe Checkout Session for the selected Pro/Max plan.
 * Does not kick off SMS — that waits for checkout.session.completed (or the
 * success page applying the same sync helper).
 */
export async function createCheckoutSessionAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const plan = parsePlan(formData);
  if (!plan) redirect('/payment?error=plan');

  const brand = await brandForUser(user.id);
  if (!brand) redirect('/payment?error=nobrand');

  if (hasPaidAccess(brand.facts)) {
    redirect('/check-messages');
  }

  if (!stripeConfigured()) redirect('/payment?error=unavailable');

  let catalog;
  try {
    catalog = requireStripePriceCatalog();
  } catch {
    redirect('/payment?error=unavailable');
  }

  const priceId = stripePriceIdForPlan(plan, catalog);
  const base = appBaseUrl();
  const stripe = getStripe();
  const existingCustomer = brand.facts?.payment?.stripe_customer_id;
  const couponId = brand.facts?.payment?.discount?.coupon_id;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/payment?canceled=1`,
      client_reference_id: brand.id,
      metadata: {
        brandId: brand.id,
        userId: user.id,
        tier: plan.tier,
        interval: plan.interval,
      },
      subscription_data: {
        metadata: {
          brandId: brand.id,
          userId: user.id,
          tier: plan.tier,
          interval: plan.interval,
        },
      },
      // Prices are GST-inclusive AUD list amounts — do not add exclusive tax on top.
      automatic_tax: { enabled: false },
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      ...(existingCustomer
        ? { customer: existingCustomer }
        : user.email
          ? { customer_email: user.email }
          : {}),
    });
    if (!session.url) redirect('/payment?error=stripe');
    redirect(session.url);
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[billing] checkout session failed:', err instanceof Error ? err.message : err);
    redirect('/payment?error=stripe');
  }
}

export async function createPortalSessionAction(): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const brand = await brandForUser(user.id);
  const customerId = brand?.facts?.payment?.stripe_customer_id;
  if (!brand || !customerId) redirect('/app/billing?error=nocustomer');
  if (!stripeConfigured()) redirect('/app/billing?error=unavailable');

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl()}/app/billing`,
    });
    if (!session.url) redirect('/app/billing?error=portal');
    redirect(session.url);
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[billing] portal session failed:', err instanceof Error ? err.message : err);
    redirect('/app/billing?error=portal');
  }
}
