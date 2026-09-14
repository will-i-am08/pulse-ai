'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitPaymentAction } from '@/lib/actions/billing';
import styles from './payment.module.css';

export type PaymentPlanTier = 'pro' | 'max';
export type PaymentInterval = 'month' | 'year';

type Props = {
  initialTier: PaymentPlanTier;
  initialInterval: PaymentInterval;
  error?: string | null;
};

const PRICES = {
  pro: { month: 79, year: 63 },
  max: { month: 149, year: 119 },
} as const;

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
      <span>{pending ? 'Starting Kip…' : label}</span>
    </button>
  );
}

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function PaymentForm({ initialTier, initialInterval, error }: Props) {
  const [tier, setTier] = useState<PaymentPlanTier>(initialTier);
  const [interval, setInterval] = useState<PaymentInterval>(initialInterval);
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const annual = interval === 'year';
  const price = PRICES[tier][interval];
  const submitLabel = `Pay $${price}/mo · start ${tier === 'max' ? 'Max' : 'Pro'}`;

  return (
    <form className={styles.card} action={submitPaymentAction}>
      <h1 className={styles.h1}>Choose your plan</h1>
      <p className={styles.sub}>
        Pick Pro or Max, then continue. Payment processing isn’t connected yet — this just starts your
        setup texts with Kip.
      </p>
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

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.fields}>
        <p className={styles.sectionLabel}>Card details</p>
        <p className={styles.hint}>
          Demo fields only — nothing is charged and card details are not stored.
        </p>
        <label className={styles.label}>
          Name on card
          <input
            className={styles.input}
            name="card_name"
            autoComplete="cc-name"
            placeholder="Alex Taylor"
            required
          />
        </label>
        <label className={styles.label}>
          Card number
          <input
            className={styles.input}
            name="card_number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            required
            minLength={14}
          />
        </label>
        <div className={styles.row}>
          <label className={styles.label}>
            Expiry
            <input
              className={styles.input}
              name="card_expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              required
              minLength={5}
            />
          </label>
          <label className={styles.label}>
            CVC
            <input
              className={styles.input}
              name="card_cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              required
              maxLength={4}
              pattern="[0-9]{3,4}"
            />
          </label>
        </div>
      </div>

      <SubmitButton label={submitLabel} />
      <p className={styles.hint}>
        Prices in AUD
        {annual ? ' · annual shown as monthly equivalent' : ''}. Cancel anytime once billing is live.
      </p>
    </form>
  );
}
