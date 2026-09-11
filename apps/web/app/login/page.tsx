import Link from 'next/link';
import { requestLoginCode } from '@/lib/actions/auth';
import { operatorLoginAction } from '@/lib/actions/operator-auth';
import { BrandLockup } from '../components/BrandLockup';
import styles from '../auth.module.css';

export const metadata = { title: 'Log in | Kip' };

const ERRORS: Record<string, string> = {
  badphone: 'That doesn’t look like a valid mobile number. Try again (e.g. 04xx xxx xxx).',
  nouser: 'We don’t have an account for that number. Create one to get started.',
  exists: 'You already have an account — enter your number to log in.',
  phoneinuse: 'That mobile number is already linked to a Kip account. Log in with it instead.',
  operator: 'Incorrect operator password.',
  noadmin: 'No operator account exists yet.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const { error, redirectTo } = await searchParams;
  const msg = error ? (ERRORS[error] ?? 'Something went wrong. Please try again.') : null;
  const isOperatorError = error === 'operator' || error === 'noadmin';
  const next =
    redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')
      ? redirectTo
      : '/lab';

  return (
    <main className={styles.wrap}>
      <BrandLockup href="/" className={styles.brand} size={36} />
      <form className={styles.card} action={requestLoginCode}>
        <h1 className={styles.h1}>Log in</h1>
        <p className={styles.sub}>Enter your mobile number and Kip will text you a code.</p>
        {msg && !isOperatorError && <p className={styles.error}>{msg}</p>}
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
        </label>
        <button className={styles.button} type="submit">Send me a code</button>
        <p className={styles.alt}>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </form>

      <details
        className={styles.operator}
        open={
          next === '/lab' ||
          next.startsWith('/lab/') ||
          isOperatorError
        }
      >
        <summary>Operator login</summary>
        <form className={styles.operatorForm} action={operatorLoginAction}>
          <input type="hidden" name="redirectTo" value={next} />
          {isOperatorError && msg && (
            <p className={styles.error}>{msg}</p>
          )}
          <label className={styles.label}>
            Operator password
            <input className={styles.input} type="password" name="password" autoComplete="off" />
          </label>
          <button className={styles.buttonGhost} type="submit">Sign in as operator</button>
          <span className={styles.hint}>Opens the agent lab. Also break-glass if SMS login is down.</span>
        </form>
      </details>
    </main>
  );
}
