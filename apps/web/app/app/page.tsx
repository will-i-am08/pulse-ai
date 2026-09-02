import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { listBrands, listBrandsForOwner } from '@/lib/data/brands';
import type { OnboardingStatus } from '@pulse/shared';

export const dynamic = 'force-dynamic';

function setupLabel(status: OnboardingStatus | undefined): string {
  switch (status) {
    case 'pending':
      return 'The agent is about to message you to get set up.';
    case 'in_progress':
      return 'Setup in progress — reply to the agent to finish.';
    case 'done':
      return 'Set up and ready. Send a photo anytime.';
    default:
      return 'Ready.';
  }
}

export default async function DashboardHome() {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Admin (operator) sees every brand; a normal user sees only their own agent.
  if (user.is_admin) {
    const brands = await listBrands();
    return (
      <section>
        <div className="page-header">
          <h1>All brands</h1>
          <Link href="/app/brands/new" className="btn-primary">
            Add brand
          </Link>
        </div>
        {brands.length === 0 ? (
          <p className="empty">No brands yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Setup</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.owner_user_id ? 'user' : '—'}</td>
                  <td>{b.onboarding_state?.status ?? 'none'}</td>
                  <td>
                    <span className={`badge badge-${b.status}`}>{b.status}</span>
                  </td>
                  <td>
                    <Link href={`/app/brands/${b.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];

  return (
    <section>
      <div className="page-header">
        <h1>Your agent</h1>
      </div>
      {!brand ? (
        <p className="empty">We’re setting up your account…</p>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{brand.name}</h2>
          <p style={{ color: 'var(--muted, #667)' }}>{setupLabel(brand.onboarding_state?.status)}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            <Link href={`/app/brands/${brand.id}/voice`}>Edit brand voice</Link>
            <Link href={`/app/brands/${brand.id}`}>Approvals</Link>
            <Link href={`/app/brands/${brand.id}/history`}>Post history</Link>
          </div>
        </div>
      )}
    </section>
  );
}
