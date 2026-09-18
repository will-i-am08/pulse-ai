import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandLockup } from '../components/BrandLockup';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { hasPaidAccess } from '@pulse/shared';
import styles from '../auth.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Check your messages | Kip' };

const EARLY_ONBOARDING = new Set([
  'none',
  'pending',
  'awaiting_contact',
  'awaiting_connect',
  'reading_content',
]);

export default async function CheckMessagesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0] ?? null;

  if (!brand || !hasPaidAccess(brand.facts)) {
    redirect('/payment');
  }

  const status = brand.onboarding_state?.status ?? 'none';
  // Past the welcome / connect SMS phase — dashboard is fine.
  if (!EARLY_ONBOARDING.has(status)) {
    redirect('/app');
  }

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <div className={styles.card}>
        <h1 className={styles.h1}>Check your messages</h1>
        <p className={styles.sub}>
          Kip just texted you a welcome — add the contact card, then follow the steps in Messages
          before you dive into the dashboard.
        </p>
        <p className={styles.hint} style={{ margin: 0 }}>
          You can leave this page and open Messages on your phone. Come back to the app anytime.
        </p>
        <Link className={styles.button} href="/app" style={{ textAlign: 'center', textDecoration: 'none' }}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
