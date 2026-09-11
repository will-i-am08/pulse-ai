import type { ReactNode } from 'react';
import { currentUser } from '@/lib/auth/current-user';
import { DashShell } from './DashShell';
import './workspace.css';

// The operator console is authed and per-request (reads the DB, uses cookies),
// so it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return <DashShell isAdmin={Boolean(user?.is_admin)}>{children}</DashShell>;
}
