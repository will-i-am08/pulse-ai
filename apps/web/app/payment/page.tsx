import { redirect } from 'next/navigation';
import { BrandLockup } from '../components/BrandLockup';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { hasPaidAccess } from '@pulse/shared';
import { PaymentForm, type PaymentInterval, type PaymentPlanTier } from './PaymentForm';
import styles from './payment.module.css';
import { isStripeTestMode } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment | Kip' };

const ERRORS: Record<string, string> = {
  plan: 'Pick a plan to continue.',
  nobrand: 'We couldn’t find your brand. Try signing up again.',
  unavailable: 'Payments aren’t available yet. Try again in a moment.',
  stripe: 'Stripe couldn’t start checkout. Please try again.',
  session: 'We couldn’t confirm that payment. If you were charged, refresh in a few seconds.',
};

function parseTier(raw: string | undefined | null): PaymentPlanTier | null {
  const v = (raw ?? '').toLowerCase();
  return v === 'pro' || v === 'max' ? v : null;
}

function parseInterval(raw: string | undefined | null): PaymentInterval | null {
  const v = (raw ?? '').toLowerCase();
  if (v === 'month' || v === 'monthly') return 'month';
  if (v === 'year' || v === 'annual' || v === 'yearly') return 'year';
  return null;
}

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; billing?: string; error?: string; canceled?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { plan: planQ, billing: billingQ, error, canceled } = await searchParams;
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0] ?? null;

  if (hasPaidAccess(brand?.facts)) {
    const status = brand?.onboarding_state?.status ?? 'none';
    if (
      status === 'none' ||
      status === 'pending' ||
      status === 'awaiting_contact' ||
      status === 'awaiting_connect' ||
      status === 'reading_content'
    ) {
      redirect('/check-messages');
    }
    redirect('/app');
  }

  const fromFacts = brand?.facts?.plan ?? brand?.facts?.plan_preference;
  const tier: PaymentPlanTier =
    parseTier(planQ) ?? parseTier(fromFacts?.tier) ?? 'pro';
  const interval: PaymentInterval =
    parseInterval(billingQ) ?? parseInterval(fromFacts?.interval) ?? 'month';

  const msg = error ? (ERRORS[error] ?? 'Something went wrong. Please try again.') : null;

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <PaymentForm
        initialTier={tier}
        initialInterval={interval}
        error={msg}
        canceled={canceled === '1' || canceled === 'true'}
        testMode={isStripeTestMode()}
      />
    </main>
  );
}
