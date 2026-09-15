import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { canAccessAppPath, canAccessBillingPortal } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { DashShell } from './DashShell';
import './workspace.css';

// The operator console is authed and per-request (reads the DB, uses cookies),
// so it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const pathname = (await headers()).get('x-pathname') || '/app';

  if (!user.is_admin) {
    const brands = await listBrandsForOwner(user.id);
    const facts = brands[0]?.facts ?? null;
    if (!canAccessAppPath(pathname, facts)) {
      if (canAccessBillingPortal(facts)) redirect('/app/billing');
      redirect('/payment');
    }
  }

  return <DashShell isAdmin={Boolean(user.is_admin)}>{children}</DashShell>;
}
