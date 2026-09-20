import { redirect } from 'next/navigation';
import { BrandLockup } from '../../components/BrandLockup';
import { currentUser } from '@/lib/auth/current-user';
import { stripeConfigured, getStripe } from '@/lib/stripe';
import { applyCheckoutSessionToBrand } from '@/lib/billing/sync';
import styles from '../payment.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment | Kip' };

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { session_id: sessionId } = await searchParams;
  if (!sessionId) redirect('/payment?error=session');
  if (!stripeConfigured()) redirect('/payment?error=unavailable');

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
    if (session.metadata?.userId && session.metadata.userId !== user.id) {
      redirect('/payment?error=session');
    }
    if (session.status === 'complete' || session.payment_status === 'paid') {
      await applyCheckoutSessionToBrand(session);
    }
  } catch (err) {
    if (typeof err === 'object' && err && 'digest' in err) throw err;
    console.error('[billing] success page failed:', err instanceof Error ? err.message : err);
    redirect('/payment?error=session');
  }

  redirect('/check-messages');

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <p className={styles.hint}>Confirming payment…</p>
    </main>
  );
}
