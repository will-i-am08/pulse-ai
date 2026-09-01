import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOutAction } from '@/lib/actions/auth';

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
