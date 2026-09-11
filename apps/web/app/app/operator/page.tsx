import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrands } from '@/lib/data/brands';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operator | Kip' };

function isConnected(b: Brand): boolean {
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}

function line(b: Brand): string {
  const handle = b.ig_username ? `@${b.ig_username}` : isConnected(b) ? b.fb_page_name ?? 'connected' : 'Not connected';
  const setup = b.onboarding_state?.status ?? 'none';
  return `${handle} · setup ${setup} · ${b.status}`;
}

export default async function OperatorPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.is_admin) redirect('/app');

  const brands = await listBrands();

  return (
    <section className="stage">
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h1 className="page-h1">All brands</h1>
          <Link className="pill-dark" href="/app/brands/new">
            Add brand
          </Link>
        </div>
        <p className="lead">Every teammate Kip is running.</p>

        {brands.length === 0 ? (
          <p className="empty">No brands yet.</p>
        ) : (
          brands.map((b) => (
            <Link key={b.id} className="brand-card" href={`/app/brands/${b.id}`}>
              <strong>{b.name}</strong>
              <p className="empty" style={{ margin: '4px 0 0' }}>{line(b)}</p>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
