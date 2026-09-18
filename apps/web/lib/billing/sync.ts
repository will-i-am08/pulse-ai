import 'server-only';
import {
  mergeSubscriptionIntoFacts,
  query,
  queryOne,
  shouldKickOffOnboarding,
  type Brand,
  type BusinessFacts,
  type StripePriceCatalog,
} from '@pulse/shared';
import { kickOffOnboardingAfterPayment } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';
import type Stripe from 'stripe';
import { loadStripePriceCatalogOrNull } from './catalog';
import {
  checkoutCustomerId,
  checkoutSubscriptionId,
  invoiceSubscriptionId,
  stripeObjectId,
  subscriptionPeriodEnd,
  subscriptionPrice,
  subscriptionPriceId,
} from './stripe-ids';
import { getStripe } from '@/lib/stripe';

export async function persistBrandFacts(brandId: string, facts: BusinessFacts): Promise<void> {
  await query('update brands set facts = $1::jsonb where id = $2', [
    JSON.stringify(facts),
    brandId,
  ]);
}

export async function loadBrand(brandId: string): Promise<Brand | null> {
  return queryOne<Brand>('select * from brands where id = $1', [brandId]);
}

export async function retrieveStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  });
}

export function factsFromSubscription(
  facts: BusinessFacts,
  sub: Stripe.Subscription,
  catalog?: StripePriceCatalog | null,
): BusinessFacts {
  const price = subscriptionPrice(sub);
  return mergeSubscriptionIntoFacts(facts, {
    status: sub.status,
    customerId: stripeObjectId(sub.customer),
    subscriptionId: sub.id,
    priceId: subscriptionPriceId(sub),
    lookupKey: price?.lookup_key,
    priceMetadata: price?.metadata ?? null,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    catalog,
  });
}

export async function applySubscriptionToBrand(
  brandId: string,
  sub: Stripe.Subscription,
  catalog?: StripePriceCatalog | null,
): Promise<Brand> {
  const resolved = catalog === undefined ? await loadStripePriceCatalogOrNull() : catalog;
  const brand = await loadBrand(brandId);
  if (!brand) throw new Error(`applySubscriptionToBrand: brand ${brandId} not found`);
  const facts = factsFromSubscription(brand.facts ?? {}, sub, resolved);
  await persistBrandFacts(brandId, facts);
  return { ...brand, facts };
}

export async function kickOffIfPending(brandId: string): Promise<boolean> {
  const brand = await loadBrand(brandId);
  if (!brand) return false;
  const status = brand.onboarding_state?.status ?? 'none';
  if (!shouldKickOffOnboarding(status)) return false;
  try {
    const greeting = await kickOffOnboardingAfterPayment(brand.id);
    await sendToBrand(brand.id, greeting);
    return true;
  } catch (err) {
    console.error('[billing] kickoff failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

export async function applyCheckoutSessionToBrand(
  session: Stripe.Checkout.Session,
): Promise<{ brandId: string; kickedOff: boolean } | null> {
  const brandId =
    session.client_reference_id ||
    session.metadata?.brandId ||
    null;
  if (!brandId) {
    console.warn('[billing] checkout session missing brandId', session.id);
    return null;
  }

  const catalog = await loadStripePriceCatalogOrNull();
  let subId = checkoutSubscriptionId(session);
  if (!subId && session.mode === 'subscription') {
    const full = await getStripe().checkout.sessions.retrieve(session.id, {
      expand: ['subscription'],
    });
    subId = checkoutSubscriptionId(full);
  }
  if (!subId) {
    console.warn('[billing] checkout session has no subscription', session.id);
    return null;
  }

  const sub = await retrieveStripeSubscription(subId);
  const customerId = checkoutCustomerId(session) ?? stripeObjectId(sub.customer);
  const withCustomer: Stripe.Subscription = customerId
    ? ({ ...sub, customer: customerId } as Stripe.Subscription)
    : sub;
  await applySubscriptionToBrand(brandId, withCustomer, catalog);

  const email = session.customer_details?.email?.trim().toLowerCase();
  const userId = session.metadata?.userId;
  if (email && userId) {
    await query(
      `update users set email = $1
        where id = $2 and (email is null or email = '')`,
      [email, userId],
    );
  }

  const kickedOff = await kickOffIfPending(brandId);
  return { brandId, kickedOff };
}

export async function applyInvoiceToBrand(invoice: Stripe.Invoice): Promise<string | null> {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return null;
  const sub = await retrieveStripeSubscription(subId);
  const brandId = sub.metadata?.brandId;
  if (!brandId) {
    const customerId = stripeObjectId(sub.customer) ?? stripeObjectId(invoice.customer);
    if (!customerId) return null;
    const brand = await queryOne<Brand>(
      `select * from brands
        where facts->'payment'->>'stripe_customer_id' = $1
        order by created_at asc
        limit 1`,
      [customerId],
    );
    if (!brand) return null;
    await applySubscriptionToBrand(brand.id, sub);
    return brand.id;
  }
  await applySubscriptionToBrand(brandId, sub);
  return brandId;
}

export async function applyStripeSubscriptionEvent(sub: Stripe.Subscription): Promise<string | null> {
  const brandId = sub.metadata?.brandId;
  if (brandId) {
    await applySubscriptionToBrand(brandId, sub);
    return brandId;
  }
  const customerId = stripeObjectId(sub.customer);
  if (!customerId) return null;
  const brand = await queryOne<Brand>(
    `select * from brands
      where facts->'payment'->>'stripe_customer_id' = $1
      order by created_at asc
      limit 1`,
    [customerId],
  );
  if (!brand) return null;
  await applySubscriptionToBrand(brand.id, sub);
  return brand.id;
}
