'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Save } from './landing-art';
import styles from '../page.module.css';

/** Pricing block with a monthly / annual toggle. Prices in AUD.
 *  Plan CTAs carry the selection into signup → payment UI. */
export function PricingPlans() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const annual = billing === 'annual';
  const billingParam = annual ? 'annual' : 'monthly';

  return (
    <>
      <div className={styles.billToggle} role="group" aria-label="Billing period">
        <button type="button" className={annual ? '' : styles.on} onClick={() => setBilling('monthly')}>
          Monthly
        </button>
        <button type="button" className={annual ? styles.on : ''} onClick={() => setBilling('annual')}>
          Annual <span className={styles.opt} style={{ fontWeight: 500 }}>−20%</span>
        </button>
        <Save className={`${styles.sketch} ${styles.dash} ${styles.doodleSave}`} />
      </div>

      <div className={styles.plans}>
        <article className={`${styles.plan} ${styles.reveal} ${styles.revealD1}`}>
          <p className={styles.planName}>Pro</p>
          <p className={styles.planPrice}>
            ${annual ? '63' : '79'} <span>/mo</span>
          </p>
          <p className={styles.planBlurb}>One brand. Everyday posting. You stay in the thread.</p>
          <ul className={styles.planList}>
            <li>Instagram, Facebook, X, Threads</li>
            <li>Drafts in your voice</li>
            <li>Approvals in the thread</li>
            <li>Calendar + content plan</li>
            <li>Weekly check-in + Friday recap</li>
          </ul>
          <Link className={styles.pillDark} href={`/signup?plan=pro&billing=${billingParam}`}>
            Start Pro
          </Link>
        </article>

        <article className={`${styles.plan} ${styles.featured} ${styles.reveal} ${styles.revealD2}`}>
          <p className={styles.planName}>Max</p>
          <p className={styles.planPrice}>
            ${annual ? '119' : '149'} <span>/mo</span>
          </p>
          <p className={styles.planBlurb}>Hand Kip the lot. Autopilot when you want evenings back.</p>
          <ul className={styles.planList}>
            <li>Everything in Pro</li>
            <li>Autopilot with a heads-up</li>
            <li>Editable memory files</li>
            <li>Routines you write in a sentence</li>
            <li>Priority setup with Pulse</li>
          </ul>
          <Link className={styles.pillDark} href={`/signup?plan=max&billing=${billingParam}`}>
            Start Max
          </Link>
        </article>
      </div>

      <p className={`${styles.priceNote} ${styles.reveal}`}>
        Prices in AUD. Cancel anytime. Annual billed up front
        {annual ? ' · shown as monthly equivalent' : ''}.
      </p>
    </>
  );
}
