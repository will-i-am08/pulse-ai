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
        <Link href="/app" className="brandmark">
          Pulse
        </Link>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center', marginLeft: 24, flex: 1 }}>
          <Link href="/app">Home</Link>
          <Link href="/app/plan">Calendar</Link>
        </nav>
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
