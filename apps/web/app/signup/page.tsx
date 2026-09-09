import Link from 'next/link';
import { signupAction } from '@/lib/actions/auth';
import styles from '../auth.module.css';

export const metadata = { title: 'Sign up | Kip' };

const ERRORS: Record<string, string> = {
  exists: 'That email is already registered. Try logging in.',
  short: 'Password must be at least 8 characters.',
  missing: 'Please fill in your name, email and password.',
  failed: 'Something went wrong. Please try again.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const msg = error ? (ERRORS[error] ?? 'Something went wrong. Please try again.') : null;

  return (
    <main className={styles.wrap}>
      <form className={styles.card} action={signupAction}>
        <h1 className={styles.h1}>Create your account</h1>
        <p className={styles.sub}>Sign up and Kip will message you to get set up.</p>
        {msg && <p className={styles.error}>{msg}</p>}

        <label className={styles.label}>
          Your name or business name
          <input className={styles.input} name="name" required autoComplete="name" />
        </label>
        <label className={styles.label}>
          Email
          <input className={styles.input} type="email" name="email" required autoComplete="email" />
        </label>
        <label className={styles.label}>
          Password
          <input className={styles.input} type="password" name="password" required minLength={8} autoComplete="new-password" />
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

        <label className={styles.label}>
          Your Discord user ID <span className={styles.opt}>(so the bot can message you)</span>
          <input className={styles.input} name="discord_user_id" placeholder="e.g. 1542889338751156349" />
          <span className={styles.hint}>
            Discord → Settings → Advanced → turn on Developer Mode, then right-click your name → Copy User ID.
          </span>
        </label>

        <button className={styles.button} type="submit">Create account</button>
        <p className={styles.alt}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
