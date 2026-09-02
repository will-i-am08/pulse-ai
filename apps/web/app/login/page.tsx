import { loginAction } from '@/lib/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const { error, redirectTo } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Pulse Operator Console</h1>
        <p className="hint">Enter the operator password to continue.</p>

        <form action={loginAction} className="form">
          <input type="hidden" name="redirectTo" value={redirectTo && redirectTo.startsWith('/') ? redirectTo : '/'} />
          <label>
            Password
            <input type="password" name="password" required autoFocus />
          </label>
          <button type="submit" className="btn-primary">
            Sign in
          </button>
          {error && <p className="error">Incorrect password.</p>}
        </form>
      </div>
    </div>
  );
}
