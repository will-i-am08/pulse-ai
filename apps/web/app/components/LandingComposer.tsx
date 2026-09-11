'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../page.module.css';

/** The "tell Kip you're done doing social yourself" composer.
 *  A lead-in CTA: it routes to signup (the copy is just an invitation,
 *  the same behaviour as the prototype). */
export function LandingComposer() {
  const router = useRouter();

  return (
    <div className={`${styles.ask} ${styles.reveal}`}>
      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          router.push('/signup');
        }}
      >
        <input name="q" placeholder="Tell Kip you’re done doing social yourself…" aria-label="Message to Kip" />
        <button className={styles.pillDark} type="submit">
          Get started
        </button>
      </form>
      <div className={styles.chips}>
        <Link className={styles.chipLink} href="/signup">
          I’m a café
        </Link>
        <Link className={styles.chipLink} href="/signup">
          I’m a creator
        </Link>
        <Link className={styles.chipLink} href="/signup">
          I’m a founder
        </Link>
      </div>
    </div>
  );
}
