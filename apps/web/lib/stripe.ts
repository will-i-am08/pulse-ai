import 'server-only';
import Stripe from 'stripe';
import { stripeKeyAllowedOnDeploy } from '@pulse/shared';

let client: Stripe | null = null;

function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

function liveKeyAllowed(): boolean {
  return (process.env.STRIPE_ALLOW_LIVE ?? '').trim().toLowerCase() === 'true';
}

export function stripeConfigured(): boolean {
  const key = stripeSecretKey();
  if (!key) return false;
  if (
    !stripeKeyAllowedOnDeploy({
      secretKey: key,
      vercelEnv: process.env.VERCEL_ENV,
      allowLive: liveKeyAllowed(),
    })
  ) {
    console.error(
      '[stripe] live key blocked outside Production — use the Kip ai test (sk_test_) secret',
    );
    return false;
  }
  return true;
}

export function isStripeTestMode(): boolean {
  return (stripeSecretKey() ?? '').startsWith('sk_test_');
}

export function getStripe(): Stripe {
  const key = stripeSecretKey();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  if (
    !stripeKeyAllowedOnDeploy({
      secretKey: key,
      vercelEnv: process.env.VERCEL_ENV,
      allowLive: liveKeyAllowed(),
    })
  ) {
    throw new Error(
      'Live Stripe keys are blocked on Preview/Development. Use the Kip ai test sk_test_ key.',
    );
  }
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
