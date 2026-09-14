import type { Metadata } from 'next';
import Link from 'next/link';
import { createDemoAction } from '@/lib/actions/demo';
import { PendingSubmitButton } from '../../components/PendingSubmitButton';
import styles from '../demo.module.css';

export const metadata: Metadata = {
  title: 'Try Kip with your website',
  description: 'Paste your site — Kip drafts sample posts in your vibe. Nothing posts without your yes.',
};

export default async function DemoNewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className={styles.wrap}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="Kip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={32} height={32} alt="" />
          <span>Kip</span>
        </Link>

        <div className={styles.hero}>
          <h1>Kip</h1>
          <p>
            Paste your website. Kip drafts a few sample posts in your look — proof before you text a
            photo for real.
          </p>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <form className={styles.form} action={createDemoAction}>
          <label htmlFor="url">Your website</label>
          <div className={styles.row}>
            <input
              className={styles.input}
              id="url"
              name="url"
              type="text"
              inputMode="url"
              placeholder="yourcafe.com.au"
              required
              autoFocus
            />
            <PendingSubmitButton className={styles.btn} idleLabel="Show me" pendingLabel="Working…" />
          </div>
        </form>

        <p className={styles.note}>Samples expire in 48 hours. Nothing posts from a demo.</p>
      </div>
    </main>
  );
}
