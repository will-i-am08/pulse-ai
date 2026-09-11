import Link from 'next/link';
import { verifyLoginCode, requestLoginCode } from '@/lib/actions/auth';
import { maskPhone } from '@pulse/shared';
import { BrandLockup } from '../../components/BrandLockup';
import styles from '../../auth.module.css';

export const metadata = { title: 'Enter code | Kip' };

const ERRORS: Record<string, string> = {
  wrong: 'That code isn’t right. Check the latest message and try again.',
  expired: 'That code has expired. Send a fresh one.',
  locked: 'Too many tries. Send a new code and try again.',
};

const WARNINGS: Record<string, string> = {
  undelivered:
    'We couldn’t text your code just now. Tap “Send a new code” in a moment — if it keeps failing, Kip’s SMS line may be misconfigured.',
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string; new?: string; warn?: string }>;
}) {
  const { phone, error, new: isNew, warn } = await searchParams;
  const msg = error ? (ERRORS[error] ?? 'Something went wrong. Please try again.') : null;
  const warning = !msg && warn ? (WARNINGS[warn] ?? null) : null;

  if (!phone) {
    return (
      <main className={styles.wrap}>
        <BrandLockup href="/" className={styles.brand} size={36} />
        <div className={styles.card}>
          <h1 className={styles.h1}>Enter your code</h1>
          <p className={styles.error}>We lost track of your number. Please start again.</p>
          <p className={styles.alt}>
            <Link href="/login">Back to log in</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <form className={styles.card} action={verifyLoginCode}>
        <h1 className={styles.h1}>Enter your code</h1>
        <p className={styles.sub}>
          {isNew ? 'Welcome! ' : ''}
          {warning
            ? `We prepared a 6-digit code for ${maskPhone(phone)}, but the text didn’t go through yet.`
            : `Kip just messaged a 6-digit code to ${maskPhone(phone)}.`}
        </p>
        {msg && <p className={styles.error}>{msg}</p>}
        {warning && <p className={styles.error}>{warning}</p>}
        <input type="hidden" name="phone" value={phone} />
        <label className={styles.label}>
          Code
          <input
            className={styles.input}
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
          />
        </label>
        <button className={styles.button} type="submit">Verify and continue</button>
      </form>

      <form className={styles.resend} action={requestLoginCode}>
        <input type="hidden" name="phone" value={phone} />
        <button className={styles.buttonGhost} type="submit">Didn’t get it? Send a new code</button>
      </form>
    </main>
  );
}
