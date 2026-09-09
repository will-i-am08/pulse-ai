import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLockup } from './components/BrandLockup';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Kip | Your social media, handled',
  description:
    "Text a photo. Kip writes the caption in your brand's voice, you approve it with a tap, and it posts to Instagram and Facebook. No apps, no scheduling tools, nothing to learn.",
};

const steps = [
  {
    n: '01',
    t: 'Text a photo',
    d: 'To one number, like texting a friend. No app to download, no login, no portal. Just your phone.',
  },
  {
    n: '02',
    t: 'Get a caption back',
    d: 'Written for your brand, in your voice, in seconds. It reads your photo and writes for it.',
  },
  {
    n: '03',
    t: 'Reply “yes”',
    d: 'Or tweak the wording. You approve every post before it goes anywhere. You’re always in control.',
  },
  {
    n: '04',
    t: 'It’s posted for you',
    d: 'To Instagram and Facebook, at the right time, with a link back so you can see it live.',
  },
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <BrandLockup className={styles.brand} size={32} />
        <nav className={styles.navLinks}>
          <a href="#how">How it works</a>
          <Link href="/login" className={styles.navLogin}>
            Operator login
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>For small businesses and creators</p>
        <h1 className={styles.h1}>
          Text a photo.
          <br />
          It’s posted. <span className={styles.accentText}>On brand</span>.
        </h1>
        <p className={styles.lede}>
          Send a photo, it writes the caption in your voice, you tap yes, it goes to Instagram and
          Facebook.
        </p>
        <div className={styles.ctaRow}>
          <a href="mailto:will@jmcalder.com?subject=Kip" className={styles.ctaPrimary}>
            Get started
          </a>
          <a href="#how" className={styles.ctaLink}>
            See how it works
          </a>
        </div>
        <p className={styles.trust}>Nothing posts without your approval.</p>
      </section>

      <section id="how" className={styles.proof}>
        <figure className={styles.thread} aria-label="Example text thread">
          <div className={`${styles.msg} ${styles.out}`}>
            <div className={styles.threadPhoto} role="img" aria-label="A photo of a coffee and pastry">
              <span className={styles.photoSurface} />
              <span className={styles.photoCup} />
              <span className={styles.photoPastry} />
            </div>
          </div>
          <div className={`${styles.msg} ${styles.in}`}>
            <p>
              Saturday morning energy — first pour of the day. Come grab a cup before the almond
              croissants go.
              <br />
              <br />
              Reply yes to post to Instagram and Facebook.
            </p>
          </div>
          <div className={`${styles.msg} ${styles.out}`}>
            <p className={styles.yes}>yes</p>
          </div>
        </figure>
      </section>

      <section className={styles.section}>
        <ol className={styles.steps}>
          {steps.map((s) => (
            <li key={s.n} className={styles.step}>
              <span className={styles.stepNum}>{s.n}</span>
              <div>
                <h2 className={styles.stepTitle}>{s.t}</h2>
                <p className={styles.stepDesc}>{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.closer}>
        <h2 className={styles.closerTitle}>Never stare at a blank caption box again.</h2>
        <a href="mailto:will@jmcalder.com?subject=Kip" className={styles.ctaPrimary}>
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
