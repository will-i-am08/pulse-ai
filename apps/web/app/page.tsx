import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLockup } from './components/BrandLockup';
import { Thread } from './components/Thread';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Kip | Text a photo. It’s posted.',
  description:
    'Text a photo. Kip writes the caption, you say yes, and it’s posted to Instagram and Facebook. Nothing posts without your yes.',
};

const GET_STARTED = 'mailto:will@jmcalder.com?subject=Kip';

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-label="Kip">
        <header className={styles.nav}>
          <BrandLockup className={styles.brand} size={36} variant="white" />
          <Link href="/login" className={styles.navLogin}>
            Operator login
          </Link>
        </header>

        <div className={styles.heroCopy}>
          <h1 className={styles.h1}>
            Text a photo.
            <br />
            It’s posted.
          </h1>
          <a href={GET_STARTED} className={styles.pill}>
            Get started
          </a>
          <p className={styles.trust}>Nothing posts without your yes.</p>
        </div>

        <div className={styles.heroProduct}>
          <Thread tone="dark" size="closeup" />
        </div>
      </section>

      <section className={styles.idea} aria-label="The thread">
        <Thread tone="light" size="isolated" />
      </section>

      <section className={styles.idea} aria-label="You say yes">
        <div className={styles.ideaCopy}>
          <h2 className={styles.ideaTitle}>You say yes.</h2>
          <p className={styles.ideaBody}>Approval happens in the thread.</p>
        </div>
      </section>

      <section className={styles.idea} aria-label="Where it posts">
        <div className={styles.ideaCopy}>
          <h2 className={styles.ideaTitle}>Instagram and Facebook.</h2>
          <p className={styles.ideaBody}>Those are the only places Kip posts.</p>
        </div>
      </section>

      <section className={styles.close}>
        <h2 className={styles.h1}>
          Text a photo.
          <br />
          It’s posted.
        </h2>
        <a href={GET_STARTED} className={styles.pill}>
          Get started
        </a>
      </section>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Pulse Social Media</span>
        <span className={styles.footerLinks}>
          <a href="mailto:will@jmcalder.com">will@jmcalder.com</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </span>
      </footer>
    </main>
  );
}
