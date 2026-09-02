import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOutAction } from '@/lib/actions/auth';

// The operator console is authed and per-request (reads the DB, uses cookies),
// so it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brandmark">
          Pulse Operator Console
        </Link>
        <form action={signOutAction}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
