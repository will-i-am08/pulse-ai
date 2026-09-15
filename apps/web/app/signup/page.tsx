import Link from 'next/link';
import { signupAction } from '@/lib/actions/auth';
import { BrandLockup } from '../components/BrandLockup';
import { PendingSubmitButton } from '../components/PendingSubmitButton';
import styles from '../auth.module.css';

export const metadata = { title: 'Sign up | Kip' };

const ERRORS: Record<string, string> = {
  badphone: 'That doesn’t look like a valid mobile number. Try again (e.g. 04xx xxx xxx).',
  missing: 'Please tell us your name or business name.',
  failed: 'Something went wrong. Please try again.',
  phoneinuse:
    'That mobile number is already linked to a Kip account. Log in with it instead — or text Kip from that number if you need help.',
  unavailable:
    'This Preview deploy can’t reach the database. In Vercel, enable DATABASE_URL for Preview (same value as Production) and Redeploy.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; plan?: string; billing?: string }>;
}) {
  const { error, plan, billing } = await searchParams;
  const msg = error ? (ERRORS[error] ?? 'Something went wrong. Please try again.') : null;
  const planTier = plan === 'pro' || plan === 'max' ? plan : null;
  const planBilling =
    billing === 'annual' || billing === 'yearly' || billing === 'year'
      ? 'annual'
      : billing === 'monthly' || billing === 'month'
        ? 'monthly'
        : null;

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <form className={styles.card} action={signupAction}>
        <h1 className={styles.h1}>Create your account</h1>
        <p className={styles.sub}>
          Sign up, choose a plan, then Kip texts you to get set up. No password to remember.
        </p>
        {msg && <p className={styles.error}>{msg}</p>}
        {planTier && <input type="hidden" name="plan" value={planTier} />}
        {planBilling && <input type="hidden" name="billing" value={planBilling} />}

        <label className={styles.label}>
          Your name or business name
          <input className={styles.input} name="name" required autoComplete="name" />
        </label>
        <label className={styles.label}>
          Mobile number
          <input
            className={styles.input}
            type="tel"
            name="phone"
            required
            autoComplete="tel"
            inputMode="tel"
            placeholder="04xx xxx xxx"
          />
          <span className={styles.hint}>This is how you log in — Kip texts you a code, no password needed.</span>
        </label>
        <label className={styles.label}>
          Email <span className={styles.opt}>(optional — for receipts and updates)</span>
          <input className={styles.input} type="email" name="email" autoComplete="email" />
        </label>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>This account is for a…</legend>
          <label className={styles.radio}>
            <input type="radio" name="account_type" value="business" defaultChecked /> Business
          </label>
          <label className={styles.radio}>
            <input type="radio" name="account_type" value="personal" /> Personal
          </label>
        </fieldset>

        <label className={styles.label}>
          Website or Instagram <span className={styles.opt}>(optional — we’ll read it to learn your brand)</span>
          <input className={styles.input} name="website" placeholder="https://…" />
        </label>

        <PendingSubmitButton idleLabel="Create account" pendingLabel="Creating account…" />
        <p className={styles.alt}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
