import { NextResponse, type NextRequest } from 'next/server';
import { stripePriceCatalogFromEnv } from '@pulse/shared';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import {
  applyCheckoutSessionToBrand,
  applyInvoiceToBrand,
  applyStripeSubscriptionEvent,
  retrieveStripeSubscription,
} from '@/lib/billing/sync';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Stripe Billing webhook.
 * Verify with STRIPE_WEBHOOK_SECRET (stripe-signature). Webhook is the source
 * of truth for payment.status; the success page reuses the same sync helper.
 */
export async function POST(request: NextRequest) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: 'stripe not configured' }, { status: 503 });
  }
  if (!stripePriceCatalogFromEnv()) {
    return NextResponse.json({ ok: false, error: 'price ids not configured' }, { status: 503 });
  }

  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ ok: false, error: 'missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('[billing] signature verification failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') {
          return NextResponse.json({ ok: true, ignored: true, event: event.type });
        }
        const result = await applyCheckoutSessionToBrand(session);
        return NextResponse.json({ ok: true, event: event.type, ...result });
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const full = sub.items?.data?.[0]?.price
          ? sub
          : await retrieveStripeSubscription(sub.id);
        const brandId = await applyStripeSubscriptionEvent(full);
        return NextResponse.json({ ok: true, event: event.type, brandId });
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const brandId = await applyInvoiceToBrand(invoice);
        return NextResponse.json({ ok: true, event: event.type, brandId });
      }
      default:
        return NextResponse.json({ ok: true, ignored: true, event: event.type });
    }
  } catch (err) {
    console.error('[billing] webhook handler failed', event.type, err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'handler failed' }, { status: 500 });
  }
}
