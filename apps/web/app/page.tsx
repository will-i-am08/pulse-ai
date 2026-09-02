import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pulse — social media on autopilot',
  description:
    'Your clients text a photo. Pulse writes the caption in their brand voice, you approve in a tap, and it publishes to Instagram and Facebook. Nothing goes out without your approval.',
};

const steps = [
  {
    n: '01',
    t: 'They text a photo',
    d: 'Over plain SMS or MMS — no app to download, no login, no portal. Your client just texts you like they already do.',
  },
  {
    n: '02',
    t: 'The agent drafts the caption',
    d: "In the brand's own voice, learned from every edit you've ever made. It reads the photo and writes for it.",
  },
  {
    n: '03',
    t: 'You approve in the thread',
    d: 'Reply “yes”, tweak the wording, or skip. Nothing publishes without you — every decision is logged.',
  },
  {
    n: '04',
    t: 'It publishes on schedule',
    d: 'To Instagram and Facebook, at the right time, inside the rate limits, with a confirmation link back to the client.',
  },
];

const features = [
  {
    t: 'Learns each brand’s voice',
    d: 'Every correction becomes a rule. The captions get more on-brand the longer you run — no model training, just structured memory.',
  },
  {
    t: 'Messages clients first',
    d: 'Weekly check-ins (“anything to send me this week?”) and plain-text performance reports go out on their own. It chases the content so you don’t.',
  },
  {
    t: 'Approval is absolute',
    d: 'No post reaches a feed without a logged approval. Every draft, edit, approval and publish is timestamped and auditable.',
  },
  {
    t: 'Instagram + Facebook',
    d: 'Publishes through the official Graph API, rate-limit aware, with retry and failure alerts — so a hiccup pings you, never fails silently.',
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
        <p className={styles.eyebrow}>Social media management, on autopilot</p>
        <h1 className={styles.h1}>
          Your clients text a photo.<br />
          It goes live — <span className={styles.accentText}>on brand</span>.
        </h1>
        <p className={styles.lede}>
          Pulse turns a text message into a scheduled, on-brand Instagram and Facebook post.
          The client sends a photo, the agent writes the caption in their voice, you approve
          with a tap, and it publishes. No apps. No chasing. No busywork.
        </p>
        <div className={styles.ctaRow}>
          <a href="mailto:will@jmcalder.com?subject=Pulse%20demo" className={styles.ctaPrimary}>
            Book a demo
          </a>
          <a href="#how" className={styles.ctaGhost}>
            See how it works
          </a>
        </div>
        <p className={styles.trust}>Built for agencies · Nothing publishes without your approval</p>
      </section>

      <section id="how" className={styles.section}>
        <h2 className={styles.h2}>From text to published in four steps</h2>
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
        <h2 className={styles.h2}>The part no scheduler does</h2>
        <p className={styles.sectionLede}>
          Buffer and Later post on a calendar. Pulse runs the whole loop — it chases the content,
          learns the voice, and reports back, unprompted.
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
        <h2 className={styles.closerTitle}>Run your agency on autopilot.</h2>
        <p className={styles.closerLede}>
          One number, every client, every post — drafted, approved, and published while you sleep.
        </p>
        <a href="mailto:will@jmcalder.com?subject=Pulse%20demo" className={styles.ctaPrimary}>
          Book a demo
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
