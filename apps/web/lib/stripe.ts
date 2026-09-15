import 'server-only';
import Stripe from 'stripe';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  if (!client) {
    client = new Stripe(key, {
      typescript: true,
      appInfo: { name: 'Kip', version: '0.1.0' },
    });
  }
  return client;
}

export function resetStripeClient(): void {
  client = null;
}
