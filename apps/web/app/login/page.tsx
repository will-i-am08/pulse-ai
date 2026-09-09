import Link from 'next/link';
import { loginAction } from '@/lib/actions/auth';
import styles from '../auth.module.css';

export const metadata = { title: 'Log in | Kip' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className={styles.wrap}>
      <form className={styles.card} action={loginAction}>
        <h1 className={styles.h1}>Log in</h1>
        {error && <p className={styles.error}>Wrong email or password.</p>}
        <label className={styles.label}>
          Email
          <input className={styles.input} type="email" name="email" required autoComplete="email" />
        </label>
        <label className={styles.label}>
          Password
          <input className={styles.input} type="password" name="password" required autoComplete="current-password" />
        </label>
        <button className={styles.button} type="submit">Log in</button>
        <p className={styles.alt}>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
