import type { Metadata } from 'next';
import Link from 'next/link';
import { Thread } from './components/Thread';
import { LandingEffects } from './components/LandingEffects';
import { PricingPlans } from './components/PricingPlans';
import { LandingComposer } from './components/LandingComposer';
import {
  Underline,
  Ticks,
  ArrowYes,
  Loop,
  Cta,
  ShopIcon,
  CreatorIcon,
  FounderIcon,
  CaptionIcon,
  CalendarIcon,
  NudgeIcon,
  RecapIcon,
  YesIcon,
  AutopilotIcon,
  IgIcon,
  FbIcon,
  XIcon,
  ThreadsIcon,
  LockIcon,
  ControlIcon,
  VisibleIcon,
} from './components/landing-art';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Kip | Text a photo. It’s posted.',
  description:
    'Kip runs your organic social. Text a photo, it writes the caption in your voice, you say yes, and it posts to Instagram, Facebook, X and Threads. Nothing posts without your yes.',
};

const CROISSANT = '/brand/thread-photo.jpg';

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <main className={styles.page}>
      <LandingEffects
        navId="lp-nav"
        navSolidClass={styles.navSolid ?? 'navSolid'}
        revealClass={styles.reveal ?? 'reveal'}
        revealInClass={styles.in ?? 'in'}
      />

      {/* ── nav ── */}
      <header className={styles.nav} id="lp-nav">
        <Link className={styles.brand} href="/" aria-label="Kip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={36} height={36} alt="" />
          <span>Kip</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Landing">
          <a href="#about">About</a>
          <a href="#pricing">Pricing</a>
          <Link className={styles.navLogin} href="/login">
            Login
          </Link>
        </nav>
      </header>

      {/* ── hero ── */}
      <section className={styles.hero} id="top" data-hero aria-label="Kip">
        <div className={styles.heroCopy}>
          <h1 className={styles.h1}>
            Text a photo.
            <br />
            It’s posted.
          </h1>
          <Link className={styles.pill} href="/signup">
            Get started
          </Link>
          <p className={styles.trust}>Kip can take the lot. Nothing posts without your yes.</p>
        </div>
        <div className={styles.heroProduct}>
          <Thread tone="dark" size="closeup" />
        </div>
      </section>

      {/* ── how it works ── */}
      <section className={styles.ideas} id="how" aria-label="How Kip works">
        <div className={`${styles.ideasHead} ${styles.reveal}`}>
          <div className={styles.catSpot} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/kip-cat.png" width={52} height={52} alt="" />
          </div>
          <h2 className={styles.sketchTitle}>
            Three moves.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p>That’s the loop. Kip can also run the rest.</p>
        </div>
        <ol className={styles.how}>
          <Ticks className={`${styles.sketch} ${styles.dash} ${styles.doodleHow}`} />
          <li className={`${styles.reveal} ${styles.revealD1}`}>
            <Link className={styles.howCard} href="/signup">
              <div className={styles.howVisual}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CROISSANT} alt="An almond croissant" />
              </div>
              <div className={styles.howCopy}>
                <div className={styles.howN}>01</div>
                <h3>You send a photo.</h3>
                <p>From the floor, in the thread. That’s the brief.</p>
              </div>
            </Link>
          </li>
          <li className={`${styles.reveal} ${styles.revealD2}`}>
            <Link className={styles.howCard} href="/signup">
              <div className={styles.howVisual}>
                <p className={styles.cap}>
                  Saturday morning energy: first pour of the day. Come grab a cup before the almond
                  croissants go.
                </p>
              </div>
              <div className={styles.howCopy}>
                <div className={styles.howN}>02</div>
                <h3>Kip writes it.</h3>
                <p>In your voice. In the same thread you sent the photo.</p>
              </div>
            </Link>
          </li>
          <li className={`${styles.reveal} ${styles.revealD3}`}>
            <Link className={`${styles.howCard} ${styles.withSketch}`} href="/signup">
              <ArrowYes className={`${styles.sketch} ${styles.dash} ${styles.doodleArrowYes}`} />
              <div className={`${styles.howVisual} ${styles.howVisualDark}`}>
                <span className={styles.howYes}>yes</span>
              </div>
              <div className={styles.howCopy}>
                <div className={styles.howN}>03</div>
                <h3>You say yes.</h3>
                <p>Instagram, Facebook, X, Threads. Organic, and done.</p>
              </div>
            </Link>
          </li>
        </ol>
      </section>

      {/* ── about / who ── */}
      <section className={styles.band} id="about" aria-label="What Kip does">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            Hand it the whole job.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            Kip will run organic social until you say otherwise. Stay in the thread and tap yes, or put
            it on autopilot and get your evenings back.
          </p>
          <ul className={`${styles.jobStrip} ${styles.reveal} ${styles.revealD1}`} aria-label="What Kip handles">
            <li>
              <CaptionIcon /> Captions
            </li>
            <li>
              <CalendarIcon /> The calendar
            </li>
            <li>
              <NudgeIcon /> Monday nudge
            </li>
            <li>
              <RecapIcon /> Friday recap
            </li>
            <li>
              <YesIcon /> Tap yes
            </li>
            <li>
              <AutopilotIcon /> Autopilot
            </li>
          </ul>

          <div className={styles.who}>
            <article className={`${styles.whoCard} ${styles.reveal} ${styles.revealD1}`}>
              <div className={styles.whoArt}>
                <ShopIcon />
              </div>
              <div className={styles.whoBody}>
                <h3>The shop</h3>
                <p>
                  You were busy making the thing. Send a photo from the floor. Or don’t. Kip already
                  knows the week.
                </p>
              </div>
            </article>
            <article className={`${styles.whoCard} ${styles.reveal} ${styles.revealD2}`}>
              <div className={styles.whoArt}>
                <CreatorIcon />
              </div>
              <div className={styles.whoBody}>
                <h3>The creator</h3>
                <p>
                  Same voice, every channel, without becoming a content intern. You make the work. Kip
                  ships it.
                </p>
              </div>
            </article>
            <article className={`${styles.whoCard} ${styles.reveal} ${styles.revealD3}`}>
              <div className={styles.whoArt}>
                <FounderIcon />
              </div>
              <div className={styles.whoBody}>
                <h3>The founder</h3>
                <p>
                  You should not also be the social media manager. This is that hire, without the
                  awkward stand-up.
                </p>
              </div>
            </article>
          </div>

          <p className={styles.srOnly}>Instagram · Facebook · X · Threads</p>
          <div className={`${styles.channels} ${styles.reveal}`} aria-label="Destinations">
            <div className={styles.channel}>
              <IgIcon className={styles.brandGlyph} />
              <span>Instagram</span>
            </div>
            <div className={styles.channel}>
              <FbIcon className={styles.brandGlyph} />
              <span>Facebook</span>
            </div>
            <div className={styles.channel}>
              <XIcon className={styles.brandGlyph} />
              <span>X</span>
            </div>
            <div className={styles.channel}>
              <ThreadsIcon className={styles.brandGlyph} />
              <span>Threads</span>
            </div>
          </div>
          <p className={`${styles.destNote} ${styles.reveal} ${styles.revealD1}`}>
            Organic social. That’s the niche. Kip intends to be first in it.
          </p>

          <div className={`${styles.productFrame} ${styles.withSketch} ${styles.reveal} ${styles.revealD2}`}>
            <Loop className={`${styles.sketch} ${styles.dash} ${styles.doodleLoop}`} />
            <div className={styles.pf}>
              <h4>On its plate</h4>
              <div className={styles.rrow}>
                <span>Weekly check-in</span>
                <span className={styles.opt}>Mondays · 9:00 am</span>
              </div>
              <div className={styles.rrow}>
                <span>Friday recap</span>
                <span className={styles.opt}>Fridays · 4:00 pm</span>
              </div>
              <div className={styles.rrow}>
                <span>Quiet reminder</span>
                <span className={styles.opt}>If no photo in 10 days</span>
              </div>
              <div className={styles.rrow}>
                <span>Autopilot</span>
                <span className={styles.opt}>Heads-up, then it posts</span>
              </div>
            </div>
            <div className={styles.pf}>
              <h4>memory.md</h4>
              <div className={styles.file}>
                Organic only: Instagram, Facebook, X, Threads.
                <br />
                Never post without a yes, unless autopilot is on.
                <br />
                Tone is warm, short, no hype.
                <br />
                Almond croissant is the hero pastry.
              </div>
            </div>
          </div>

          <LandingComposer />
        </div>
      </section>

      {/* ── privacy / trust ── */}
      <section className={`${styles.band} ${styles.trustBand}`} id="privacy" aria-label="Privacy and control">
        <div className={styles.bandInner}>
          <div className={styles.reveal}>
            <div className={styles.catSpot} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/kip-cat.png" width={52} height={52} alt="" />
            </div>
          </div>
          <h2 className={`${styles.reveal} ${styles.revealD1}`}>Private, and in your control.</h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            Your data stays yours. Encrypted by default. Never used to train models.
          </p>
          <div className={styles.trustGrid}>
            <article className={`${styles.trustCard} ${styles.reveal} ${styles.revealD1}`}>
              <LockIcon className={styles.trustIco} />
              <h3>Private.</h3>
              <p>
                Photos, captions, and brand memory aren’t sold, shared for ads, or used to train
                anyone’s model, ours or a provider’s.
              </p>
            </article>
            <article className={`${styles.trustCard} ${styles.reveal} ${styles.revealD2}`}>
              <ControlIcon className={styles.trustIco} />
              <h3>In your control.</h3>
              <p>
                You set what Kip can touch. Approvals in the thread. Revoke Meta, X, or Threads anytime.
                Pause or wipe when you ask.
              </p>
            </article>
            <article className={`${styles.trustCard} ${styles.reveal} ${styles.revealD3}`}>
              <VisibleIcon className={styles.trustIco} />
              <h3>Visible.</h3>
              <p>
                Publishes, approvals, and access leave a trail. Tokens stay encrypted. Your brand
                doesn’t mingle with anyone else’s.
              </p>
            </article>
          </div>
          <p className={`${styles.trustFoot} ${styles.reveal}`}>
            Encrypted in transit and at rest. Disconnect Meta, X, or Threads anytime. Email{' '}
            <a href="mailto:will@jmcalder.com">will@jmcalder.com</a> to wipe what we hold.
          </p>
        </div>
      </section>

      {/* ── pricing ── */}
      <section className={`${styles.band} ${styles.pricing}`} id="pricing" aria-label="Pricing">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            Simple plans. Real work.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            Organic social, off your plate. No credit maths.
          </p>
          <PricingPlans />
        </div>
      </section>

      {/* ── close ── */}
      <section className={styles.close} id="get-started">
        <div className={styles.catSpot} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={48} height={48} alt="" />
        </div>
        <h2 className={styles.h1}>
          Text a photo.
          <br />
          It’s posted.
        </h2>
        <p className={styles.trust}>Or don’t. Kip will.</p>
        <div className={`${styles.closeCta} ${styles.withSketch}`}>
          <Cta className={`${styles.sketch} ${styles.dash} ${styles.onDark} ${styles.doodleCta}`} />
          <Link className={styles.pill} href="/signup">
            Get started
          </Link>
        </div>
      </section>

      {/* ── footer ── */}
      <footer className={styles.footer}>
        <Link className={styles.footerBrand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={22} height={22} alt="" />
          <span>© {year} Pulse Social Media</span>
        </Link>
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
