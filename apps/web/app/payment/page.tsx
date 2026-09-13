import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandLockup } from '../components/BrandLockup';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { PaymentForm, type PaymentInterval, type PaymentPlanTier } from './PaymentForm';
import styles from './payment.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment | Kip' };

const ERRORS: Record<string, string> = {
  plan: 'Pick a plan to continue.',
  nobrand: 'We couldn’t find your brand. Try signing up again.',
  kickoff: 'Payment saved, but we couldn’t start setup texts. Open the app and text Kip if needed.',
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
  searchParams: Promise<{ plan?: string; billing?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { plan: planQ, billing: billingQ, error } = await searchParams;
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0] ?? null;

  // Already past payment UI — send them to the messages interstitial while
  // early onboarding SMS is in flight; otherwise the dashboard.
  if (brand?.facts?.payment?.submitted_at) {
    const status = brand.onboarding_state?.status ?? 'none';
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
      <PaymentForm initialTier={tier} initialInterval={interval} error={msg} />
      <p className={styles.skip}>
        <Link href="/app">Skip for now — go to the app</Link>
      </p>
    </main>
  );
}
