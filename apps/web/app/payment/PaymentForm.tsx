'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createCheckoutSessionAction } from '@/lib/actions/billing';
import styles from './payment.module.css';

export type PaymentPlanTier = 'pro' | 'max';
export type PaymentInterval = 'month' | 'year';

const PRICES = {
  pro: { month: 79, year: 63 },
  max: { month: 149, year: 119 },
} as const;

type Props = {
  initialTier: PaymentPlanTier;
  initialInterval: PaymentInterval;
  error?: string | null;
  canceled?: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`${styles.button}${pending ? ` ${styles.buttonPending}` : ''}`}
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending && <span className={styles.spinner} aria-hidden="true" />}
      <span>{pending ? 'Redirecting to Stripe…' : label}</span>
    </button>
  );
}

export function PaymentForm({ initialTier, initialInterval, error, canceled }: Props) {
  const [tier, setTier] = useState<PaymentPlanTier>(initialTier);
  const [interval, setInterval] = useState<PaymentInterval>(initialInterval);
  const annual = interval === 'year';
  const price = PRICES[tier][interval];
  const submitLabel = `Pay $${price}/mo · start ${tier === 'max' ? 'Max' : 'Pro'}`;

  return (
    <form className={styles.card} action={createCheckoutSessionAction}>
      <h1 className={styles.h1}>Choose your plan</h1>
      <p className={styles.sub}>
        Pick Pro or Max. You’ll pay on Stripe’s checkout page — card details never touch Kip.
      </p>
      {canceled && (
        <p className={styles.error}>Checkout cancelled. Pick a plan when you’re ready.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="interval" value={interval} />

      <p className={styles.sectionLabel}>Billing</p>
      <div className={styles.billToggle} role="group" aria-label="Billing period">
        <button
          type="button"
          className={annual ? '' : styles.on}
          onClick={() => setInterval('month')}
        >
          Monthly
        </button>
        <button
          type="button"
          className={annual ? styles.on : ''}
          onClick={() => setInterval('year')}
        >
          Annual −20%
        </button>
      </div>

      <p className={styles.sectionLabel}>Plan</p>
      <div className={styles.plans} role="radiogroup" aria-label="Plan">
        {(['pro', 'max'] as const).map((id) => {
          const selected = tier === id;
          const p = PRICES[id][interval];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.plan}${selected ? ` ${styles.planSelected}` : ''}`}
              onClick={() => setTier(id)}
            >
              <p className={styles.planName}>{id === 'pro' ? 'Pro' : 'Max'}</p>
              <p className={styles.planPrice}>
                ${p} <span>/mo</span>
              </p>
              <p className={styles.planBlurb}>
                {id === 'pro'
                  ? 'Everyday posting + light UGC.'
                  : 'Autopilot, full UGC, inbox & ads.'}
              </p>
            </button>
          );
        })}
      </div>

      <SubmitButton label={submitLabel} />
      <p className={styles.hint}>
        Prices in AUD, inc. GST
        {annual ? ' · annual billed up front (shown as monthly equivalent)' : ''}. Cancel anytime —
        access continues through the period already paid.
      </p>
    </form>
  );
}
