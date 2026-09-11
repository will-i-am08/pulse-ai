import type { ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth/session';
import { DashShell } from './DashShell';
import './workspace.css';

// The operator console is authed and per-request (reads the DB, uses cookies),
// so it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return <DashShell isAdmin={Boolean(user?.is_admin)}>{children}</DashShell>;
}
