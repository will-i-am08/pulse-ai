import type { Metadata } from 'next';
import Link from 'next/link';
import { Thread } from './components/Thread';
import { LandingEffects } from './components/LandingEffects';
import { PricingPlans } from './components/PricingPlans';
import { LandingComposer } from './components/LandingComposer';
import { ThreadDemo } from './components/ThreadDemo';
import { LandingFaq } from './components/LandingFaq';
import { HeroTextKip } from './components/HeroTextKip';
import { LANDING_FAQS } from '../lib/faq';
import {
  SITE_DESCRIPTION,
  breadcrumbSchema,
  faqSchema,
  jsonLd,
  softwareApplicationSchema,
} from '../lib/seo';
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
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Kip | Text a photo. It’s posted.',
    description: SITE_DESCRIPTION,
    url: '/',
  },
};

const CROISSANT = '/brand/thread-photo.jpg';

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <main className={styles.page}>
      {/* Page-level structured data: the product itself, the FAQ, and a
          breadcrumb. This is the core GEO payload for AI answer engines. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            softwareApplicationSchema(),
            faqSchema(LANDING_FAQS),
            breadcrumbSchema([{ name: 'Home', path: '/' }]),
          ]),
        }}
      />
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
          <a href="#faq">FAQ</a>
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
          <div className={styles.heroCtas}>
            <Link className={styles.pill} href="/signup">
              Get started
            </Link>
            <HeroTextKip className={styles.pillGhost} />
            <Link className={styles.pillGhost} href="/d/new">
              Try with your website
            </Link>
          </div>
          <p className={styles.trust}>Kip can take the lot. Nothing posts without your yes.</p>
        </div>
        <div className={styles.heroProduct}>
          <Thread tone="dark" size="closeup" />
        </div>
      </section>

      {/* ── proof strip ── */}
      <section className={styles.proofStrip} aria-label="Why shops pick Kip">
        <p className={styles.proofEyebrow}>Built for shops, creators, and founders</p>
        <ul className={styles.proofStats}>
          <li>
            <strong>~$1,850–$4,900</strong>
            <span>saved vs a typical social hire each month</span>
          </li>
          <li>
            <strong>~10 min</strong>
            <span>to connect channels and send your first photo</span>
          </li>
          <li>
            <strong>4 channels</strong>
            <span>Instagram, Facebook, X, Threads — organic only</span>
          </li>
        </ul>
        <ul className={styles.proofBadges} aria-label="Trust marks">
          <li>Nothing posts without your yes</li>
          <li>Encrypted by default</li>
          <li>Cancel anytime</li>
          <li>First-week refund if it isn’t useful</li>
        </ul>
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


      {/* ── demo ── */}
      <section className={`${styles.band} ${styles.demoBand}`} id="demo" aria-label="Product demo">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            The whole job, in a text thread.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            No dashboard marathon. Send a photo, approve the caption, Kip posts. Ready in about ten
            minutes.
          </p>
          <div className={`${styles.demoStage} ${styles.reveal} ${styles.revealD2}`}>
            <ThreadDemo />
          </div>
        </div>
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


      {/* ── testimonials ── */}
      <section className={`${styles.band} ${styles.quotesBand}`} id="stories" aria-label="Customer stories">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            From people who used to do it themselves.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            Early shops and founders using Kip to stay consistent without hiring.
          </p>
          <div className={styles.quotes}>
            <figure className={`${styles.quote} ${styles.reveal} ${styles.revealD1}`}>
              <blockquote>
                “I used to ghost Instagram for weeks. Now I text Kip from the counter between orders
                and it still sounds like us.”
              </blockquote>
              <figcaption>
                <span className={styles.quoteName}>Maya R.</span>
                <span className={styles.quoteRole}>Owner, Northside Coffee</span>
              </figcaption>
            </figure>
            <figure className={`${styles.quote} ${styles.reveal} ${styles.revealD2}`}>
              <blockquote>
                “Same voice on Instagram and Threads without me becoming a content intern. I make the
                work. Kip ships it.”
              </blockquote>
              <figcaption>
                <span className={styles.quoteName}>Jordan K.</span>
                <span className={styles.quoteRole}>Creator</span>
              </figcaption>
            </figure>
            <figure className={`${styles.quote} ${styles.reveal} ${styles.revealD3}`}>
              <blockquote>
                “We were quoting social managers at four grand a month. Kip covers the organic posting
                job for a fraction — and I approve from my phone.”
              </blockquote>
              <figcaption>
                <span className={styles.quoteName}>Sam T.</span>
                <span className={styles.quoteRole}>Founder, Harbour Studio</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ── case study ── */}
      <section className={`${styles.band} ${styles.caseBand}`} id="case" aria-label="Case study">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            Before Kip, after Kip.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            One neighbourhood café. Same phone. Very different posting rhythm.
          </p>
          <div className={`${styles.caseGrid} ${styles.reveal} ${styles.revealD1}`}>
            <div className={styles.caseCol}>
              <p className={styles.caseLabel}>Before</p>
              <ul>
                <li>1–2 posts a month, usually late</li>
                <li>Captions written at midnight</li>
                <li>Facebook forgotten for weeks</li>
                <li>Owner doing the job after close</li>
              </ul>
            </div>
            <div className={`${styles.caseCol} ${styles.caseAfter}`}>
              <p className={styles.caseLabel}>After</p>
              <ul>
                <li>4–5 organic posts a week</li>
                <li>Captions approved in the thread</li>
                <li>Instagram, Facebook, X, Threads in sync</li>
                <li>~10 minutes a day, from the floor</li>
              </ul>
            </div>
          </div>
          <p className={`${styles.caseNote} ${styles.reveal} ${styles.revealD2}`}>
            Composite from early café rollouts. Your photos, your yes — Kip handles the rest.
          </p>
        </div>
      </section>

      {/* ── integrations + tool compare ── */}
      <section className={`${styles.band} ${styles.stackBand}`} id="stack" aria-label="Channels and comparisons">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            Your channels. One thread.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            Kip lives in SMS. It publishes organic to the networks you connect.
          </p>
          <ul className={`${styles.integGrid} ${styles.reveal} ${styles.revealD1}`} aria-label="Integrations">
            <li>
              <IgIcon className={styles.brandGlyph} />
              <span>Instagram</span>
            </li>
            <li>
              <FbIcon className={styles.brandGlyph} />
              <span>Facebook</span>
            </li>
            <li>
              <XIcon className={styles.brandGlyph} />
              <span>X</span>
            </li>
            <li>
              <ThreadsIcon className={styles.brandGlyph} />
              <span>Threads</span>
            </li>
            <li className={styles.integSms}>
              <span className={styles.integSmsMark} aria-hidden="true">
                ⌁
              </span>
              <span>SMS thread</span>
            </li>
          </ul>

          <div className={`${styles.reviewRow} ${styles.reveal} ${styles.revealD2}`} aria-label="Early feedback">
            <div className={styles.reviewBadge}>
              <p className={styles.reviewStars} aria-label="5 out of 5">★★★★★</p>
              <p>Early users rate Kip for voice match</p>
            </div>
            <div className={styles.reviewBadge}>
              <p className={styles.reviewStars} aria-label="5 out of 5">★★★★★</p>
              <p>Loved for speed from photo to post</p>
            </div>
            <div className={styles.reviewBadge}>
              <p className={styles.reviewMark}>Trust</p>
              <p>Encrypted · Cancel anytime · Organic only</p>
            </div>
          </div>

          <div className={`${styles.toolWrap} ${styles.reveal} ${styles.revealD2}`}>
            <table className={styles.toolTable}>
              <caption className={styles.srOnly}>Kip compared to Buffer-style tools and hiring</caption>
              <thead>
                <tr>
                  <th scope="col"> </th>
                  <th scope="col">Typical scheduler</th>
                  <th scope="col">Hire an SMM</th>
                  <th scope="col" className={styles.compareKipCol}>
                    Kip
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Writes in your voice</th>
                  <td>DIY / templates</td>
                  <td>Yes</td>
                  <td className={styles.compareKipCol}>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Lives in a text thread</th>
                  <td>No</td>
                  <td>No</td>
                  <td className={styles.compareKipCol}>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Approve before post</th>
                  <td>Sometimes</td>
                  <td>Yes</td>
                  <td className={styles.compareKipCol}>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Organic multi-channel</th>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td className={styles.compareKipCol}>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Typical monthly cost</th>
                  <td>$15–$100+</td>
                  <td>$2,000–$5,000</td>
                  <td className={styles.compareKipCol}>$79–$149</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={`${styles.stackNote} ${styles.reveal}`}>
            Schedulers still need you to write. Agencies still need stand-ups. Kip is the organic hire
            that texts you back.
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


      {/* ── faq ── */}
      <section className={`${styles.band} ${styles.faqBand}`} id="faq" aria-label="Frequently asked questions">
        <div className={styles.bandInner}>
          <h2 className={`${styles.sketchTitle} ${styles.reveal}`}>
            Questions, answered.
            <Underline className={`${styles.sketch} ${styles.dash}`} />
          </h2>
          <p className={`${styles.sub} ${styles.reveal} ${styles.revealD1}`}>
            The stuff people ask before they text their first photo.
          </p>
          <div className={`${styles.reveal} ${styles.revealD1}`}>
            <LandingFaq />
          </div>
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
          <Link href="/blog">Notes</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </span>
      </footer>
    </main>
  );
}
