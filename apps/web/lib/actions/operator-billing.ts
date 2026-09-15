'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  queryOne,
  stripePriceIdForPlan,
  type Brand,
  type BrandOperatorBillingAction,
  type BrandPaymentDiscount,
  type BrandPlanFacts,
  type BusinessFacts,
  type User,
} from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { requireStripePriceCatalog } from '@/lib/billing/catalog';
import {
  factsFromSubscription,
  kickOffIfPending,
  persistBrandFacts,
  retrieveStripeSubscription,
} from '@/lib/billing/sync';
import { getStripe, stripeConfigured } from '@/lib/stripe';

function billingPath(userId: string, status: 'ok' | 'error', detail?: string): string {
  const q = new URLSearchParams({ billing: status });
  if (detail) q.set('detail', detail);
  return `/app/operator/users/${userId}?${q.toString()}`;
}

async function requireOperator(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.is_admin) redirect('/app');
  return user;
}

async function brandForOwner(ownerUserId: string): Promise<Brand> {
  const brand = await queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [ownerUserId],
  );
  if (!brand) throw new Error('nobrand');
  return brand;
}

function stamp(
  facts: BusinessFacts,
  operator: User,
  action: BrandOperatorBillingAction['action'],
  note?: string,
): BusinessFacts {
  const payment = { ...(facts.payment ?? {}) };
  payment.last_operator_action = {
    action,
    at: new Date().toISOString(),
    by: operator.id,
    note,
  };
  return { ...facts, payment };
}

async function saveAndReturn(ownerUserId: string, brandId: string, facts: BusinessFacts, detail?: string) {
  await persistBrandFacts(brandId, facts);
  revalidatePath(`/app/operator/users/${ownerUserId}`);
  redirect(billingPath(ownerUserId, 'ok', detail));
}

function fail(ownerUserId: string, detail: string): never {
  redirect(billingPath(ownerUserId, 'error', detail));
}

function ownerId(formData: FormData): string {
  const id = String(formData.get('userId') ?? '').trim();
  if (!id) throw new Error('nouser');
  return id;
}

/** Grant free access. Pauses Stripe collection if a subscription exists. */
export async function operatorSetComplimentaryAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const userId = ownerId(formData);
  const reason = String(formData.get('reason') ?? '').trim() || 'Operator complimentary';
  const enable = String(formData.get('enable') ?? '1') === '1';

  try {
    const brand = await brandForOwner(userId);
    let facts: BusinessFacts = { ...(brand.facts ?? {}) };
    const payment = { ...(facts.payment ?? {}) };

    if (enable) {
      payment.complimentary = true;
      payment.complimentary_reason = reason;
      payment.complimentary_at = new Date().toISOString();
      payment.complimentary_by = operator.id;
      if (!payment.submitted_at) payment.submitted_at = payment.complimentary_at;
      if (!payment.status || payment.status === 'none' || payment.status === 'incomplete') {
        payment.status = 'active';
      }

      const subId = payment.stripe_subscription_id;
      if (subId && stripeConfigured()) {
        try {
          await getStripe().subscriptions.update(subId, {
            pause_collection: { behavior: 'void' },
          });
        } catch (err) {
          console.error('[operator-billing] pause collection failed', err);
        }
      }
      facts = stamp({ ...facts, payment }, operator, 'comp', reason);
      await persistBrandFacts(brand.id, facts);
      await kickOffIfPending(brand.id);
      revalidatePath(`/app/operator/users/${userId}`);
      redirect(billingPath(userId, 'ok', 'complimentary-on'));
    }

    payment.complimentary = false;
    delete payment.complimentary_reason;
    const subId = payment.stripe_subscription_id;
    if (subId && stripeConfigured()) {
      try {
        await getStripe().subscriptions.update(subId, {
          pause_collection: '',
        } as Parameters<ReturnType<typeof getStripe>['subscriptions']['update']>[1]);
      } catch (err) {
        console.error('[operator-billing] resume collection failed', err);
      }
    }
    facts = stamp({ ...facts, payment }, operator, 'uncomp');
    await saveAndReturn(userId, brand.id, facts, 'complimentary-off');
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[operator-billing] complimentary failed', err);
    fail(userId, 'comp');
  }
}

/** Apply a percent-off coupon to the Stripe customer / subscription. */
export async function operatorApplyDiscountAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const userId = ownerId(formData);
  const percent = Number(formData.get('percent_off'));
  const durationRaw = String(formData.get('duration') ?? 'forever');
  const duration: BrandPaymentDiscount['duration'] =
    durationRaw === 'once' || durationRaw === 'repeating' || durationRaw === 'forever'
      ? durationRaw
      : 'forever';
  const months = Number(formData.get('duration_in_months') ?? 3);

  if (!Number.isFinite(percent) || percent < 1 || percent > 100) fail(userId, 'discount-percent');
  if (!stripeConfigured()) fail(userId, 'unavailable');

  try {
    const brand = await brandForOwner(userId);

    const stripe = getStripe();
    const coupon = await stripe.coupons.create({
      percent_off: percent,
      duration,
      ...(duration === 'repeating' ? { duration_in_months: Math.max(1, Math.min(24, months || 3)) } : {}),
      name: `Kip operator ${percent}%`,
      metadata: { brandId: brand.id, operatorId: operator.id },
    });

    const subId = brand.facts?.payment?.stripe_subscription_id;
    if (subId) {
      await stripe.subscriptions.update(subId, { discounts: [{ coupon: coupon.id }] });
    }

    const discount: BrandPaymentDiscount = {
      percent_off: percent,
      coupon_id: coupon.id,
      duration,
      duration_in_months: duration === 'repeating' ? Math.max(1, Math.min(24, months || 3)) : undefined,
      applied_at: new Date().toISOString(),
      applied_by: operator.id,
    };
    const facts = stamp(
      { ...(brand.facts ?? {}), payment: { ...(brand.facts?.payment ?? {}), discount } },
      operator,
      'discount',
      `${percent}% ${duration}`,
    );
    await saveAndReturn(userId, brand.id, facts, 'discount');
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[operator-billing] discount failed', err);
    fail(userId, 'discount');
  }
}

/** Change Pro/Max × monthly/annual. Updates Stripe when a subscription exists. */
export async function operatorChangePlanAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const userId = ownerId(formData);
  const tierRaw = String(formData.get('tier') ?? '');
  const intervalRaw = String(formData.get('interval') ?? '');
  const tier = tierRaw === 'pro' || tierRaw === 'max' ? tierRaw : null;
  const interval = intervalRaw === 'month' || intervalRaw === 'year' ? intervalRaw : null;
  if (!tier || !interval) fail(userId, 'plan');

  try {
    const brand = await brandForOwner(userId);
    const plan: BrandPlanFacts = { tier, interval, selected_at: new Date().toISOString() };
    let facts: BusinessFacts = { ...(brand.facts ?? {}), plan, plan_preference: plan };
    const subId = facts.payment?.stripe_subscription_id;

    if (subId && stripeConfigured()) {
      const catalog = requireStripePriceCatalog();
      const priceId = stripePriceIdForPlan(plan, catalog);
      const stripe = getStripe();
      const sub = await retrieveStripeSubscription(subId);
      const itemId = sub.items.data[0]?.id;
      if (!itemId) fail(userId, 'plan-item');
      const updated = await stripe.subscriptions.update(subId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          ...(sub.metadata ?? {}),
          brandId: brand.id,
          userId,
          tier,
          interval,
        },
      });
      facts = factsFromSubscription(facts, updated, catalog);
    }

    facts = stamp(facts, operator, 'plan_change', `${tier}/${interval}`);
    await saveAndReturn(userId, brand.id, facts, 'plan');
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[operator-billing] plan change failed', err);
    fail(userId, 'plan');
  }
}

/**
 * Refund the latest paid Stripe invoice (credit note + refund).
 * Optional: cancel the subscription and/or grant complimentary access (first-week playbook).
 */
export async function operatorRefundAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const userId = ownerId(formData);
  if (String(formData.get('confirm') ?? '') !== 'refund') fail(userId, 'refund-confirm');
  if (!stripeConfigured()) fail(userId, 'unavailable');

  const keepAccess = String(formData.get('keep_access') ?? '') === '1';
  const cancelSub = String(formData.get('cancel_subscription') ?? '') === '1';
  const amountAudRaw = String(formData.get('amount_aud') ?? '').trim();

  try {
    const brand = await brandForOwner(userId);
    const customerId = brand.facts?.payment?.stripe_customer_id;
    if (!customerId) fail(userId, 'nocustomer');

    const stripe = getStripe();
    const list = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 5 });
    const invoice = list.data.find((inv) => (inv.amount_paid ?? 0) > 0) ?? list.data[0];
    if (!invoice) fail(userId, 'noinvoice');

    const maxCents = invoice.amount_paid ?? 0;
    let refundCents = maxCents;
    if (amountAudRaw) {
      const dollars = Number(amountAudRaw);
      if (!Number.isFinite(dollars) || dollars <= 0) fail(userId, 'refund-amount');
      refundCents = Math.round(dollars * 100);
      if (refundCents > maxCents) refundCents = maxCents;
    }
    if (refundCents <= 0) fail(userId, 'refund-amount');

    await stripe.creditNotes.create({
      invoice: invoice.id,
      refund_amount: refundCents,
      memo: `Operator refund by ${operator.email || operator.id}`,
      metadata: { brandId: brand.id, operatorId: operator.id },
    });

    let facts: BusinessFacts = { ...(brand.facts ?? {}) };
    const payment = { ...(facts.payment ?? {}) };

    if (cancelSub && payment.stripe_subscription_id) {
      await stripe.subscriptions.cancel(payment.stripe_subscription_id);
      payment.status = 'canceled';
    }
    if (keepAccess) {
      payment.complimentary = true;
      payment.complimentary_reason = 'Refund — keep access';
      payment.complimentary_at = new Date().toISOString();
      payment.complimentary_by = operator.id;
    }
    facts = stamp({ ...facts, payment }, operator, 'refund', `${refundCents}c on ${invoice.id}`);
    await persistBrandFacts(brand.id, facts);
    revalidatePath(`/app/operator/users/${userId}`);
    redirect(billingPath(userId, 'ok', 'refund'));
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[operator-billing] refund failed', err);
    fail(userId, 'refund');
  }
}

export async function loadLatestPaidInvoice(customerId: string): Promise<{
  id: string;
  amountPaidCents: number;
  currency: string;
  created: number;
  hostedInvoiceUrl: string | null;
} | null> {
  if (!stripeConfigured()) return null;
  const list = await getStripe().invoices.list({ customer: customerId, status: 'paid', limit: 5 });
  const invoice = list.data.find((inv) => (inv.amount_paid ?? 0) > 0) ?? list.data[0];
  if (!invoice) return null;
  return {
    id: invoice.id,
    amountPaidCents: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? 'aud',
    created: invoice.created,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };
}
