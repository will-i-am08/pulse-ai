import type Stripe from 'stripe';

export function stripeObjectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

export function subscriptionPriceId(sub: Stripe.Subscription): string | null {
  const price = sub.items.data[0]?.price;
  if (!price) return null;
  return typeof price === 'string' ? price : price.id;
}

export function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const end = sub.items.data[0]?.current_period_end;
  return typeof end === 'number' ? end : null;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (fromParent) return stripeObjectId(fromParent);
  return null;
}

export function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | null {
  return stripeObjectId(session.subscription);
}

export function checkoutCustomerId(session: Stripe.Checkout.Session): string | null {
  return stripeObjectId(session.customer);
}
