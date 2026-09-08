import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pulse | Your social media, handled',
  description:
    "Text a photo. Pulse writes the caption in your brand's voice, you approve it with a tap, and it posts to Instagram and Facebook. No apps, no scheduling tools, nothing to learn.",
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

const features = [
  {
    t: 'It sounds like you',
    d: 'Every time you tweak a caption, it learns. The more you use it, the more it writes the way you would.',
  },
  {
    t: 'Your feed never goes quiet',
    d: 'It checks in each week ("anything to post?") and sends you a simple recap of how your posts did. It does the remembering.',
  },
  {
    t: 'You approve everything',
    d: 'Nothing is ever posted without your say-so. Every draft and every approval is saved, so there are no surprises.',
  },
  {
    t: 'Instagram + Facebook',
    d: 'Posts to both, at the right time, reliably. Tells you the moment it’s live. No scheduling apps to wrestle with.',
  },
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <div className={styles.grain} aria-hidden="true" />

      <header className={styles.nav}>
        <span className={styles.brand}>
          <span className={styles.dot} aria-hidden="true" />
          Pulse
        </span>
        <nav className={styles.navLinks}>
          <a href="#how">How it works</a>
          <a href="#why">Why Pulse</a>
          <Link href="/login" className={styles.navLogin}>
            Operator login
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Your social media, on autopilot</p>
        <h1 className={styles.h1}>
          Text a photo.<br />
          It’s posted. <span className={styles.accentText}>On brand</span>.
        </h1>
        <p className={styles.lede}>
          Pulse turns a text into a scheduled, on-brand Instagram and Facebook post. Send a photo,
          it writes the caption in your voice, you tap approve, and it goes live. No apps to
          download. No scheduling tools to learn. No more staring at a blank caption box.
        </p>
        <div className={styles.ctaRow}>
          <a href="mailto:will@jmcalder.com?subject=Pulse" className={styles.ctaPrimary}>
            Get started
          </a>
          <a href="#how" className={styles.ctaGhost}>
            See how it works
          </a>
        </div>
        <p className={styles.trust}>Nothing posts without your approval · Works over plain text</p>
      </section>

      <section id="how" className={styles.section}>
        <h2 className={styles.h2}>From a text to a post in four steps</h2>
        <ol className={styles.steps}>
          {steps.map((s) => (
            <li key={s.n} className={styles.step}>
              <span className={styles.stepNum}>{s.n}</span>
              <div>
                <h3 className={styles.stepTitle}>{s.t}</h3>
                <p className={styles.stepDesc}>{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="why" className={styles.sectionAlt}>
        <h2 className={styles.h2}>The part that actually saves you time</h2>
        <p className={styles.sectionLede}>
          Scheduling apps still make you write the captions, pick the times, and remember to post.
          Pulse just does it. You only ever tap yes.
        </p>
        <div className={styles.grid}>
          {features.map((f) => (
            <div key={f.t} className={styles.card}>
              <h3 className={styles.cardTitle}>{f.t}</h3>
              <p className={styles.cardDesc}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.closer}>
        <h2 className={styles.closerTitle}>Never stare at a blank caption box again.</h2>
        <p className={styles.closerLede}>
          Your feed, kept alive and on brand. You just tap yes.
        </p>
        <a href="mailto:will@jmcalder.com?subject=Pulse" className={styles.ctaPrimary}>
          Get started
        </a>
      </section>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Pulse Social Media</span>
        <span className={styles.footerLinks}>
          <a href="mailto:will@jmcalder.com">will@jmcalder.com</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">Operator login</Link>
        </span>
      </footer>
    </main>
  );
}
