import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { listBrands } from '@/lib/data/brands';
import { listDeletionLog, listUsersForOperator, type DeletionAction } from '@/lib/data/users';
import OperatorUnownedBrands from './OperatorUnownedBrands';
import OperatorUsers from './OperatorUsers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operator | Kip' };

const ACTION_VERB: Record<DeletionAction, string> = {
  soft_delete: 'deactivated',
  hard_delete: 'permanently deleted',
  restore: 'restored',
};

export default async function OperatorPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.is_admin) redirect('/app');

  const [brands, users, deletionLog] = await Promise.all([
    listBrands(),
    listUsersForOperator(),
    listDeletionLog(),
  ]);

  const unownedBrands = brands.filter((b) => !b.owner_user_id);

  return (
    <section className="stage">
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h1 className="page-h1">Users</h1>
          <Link className="pill-dark" href="/app/brands/new">
            Add brand
          </Link>
        </div>
        <p className="lead">Every account and their brand. Click a user to open their brand. Deactivate is reversible; delete is permanent.</p>

        <OperatorUsers users={users} currentUserId={user.id} />

        {unownedBrands.length > 0 && (
          <>
            <h2 className="page-h1" style={{ marginTop: 40 }}>Unowned brands</h2>
            <p className="lead">Brands with no user attached yet. Delete removes the brand and all its data.</p>
            <OperatorUnownedBrands brands={unownedBrands} />
          </>
        )}

        {deletionLog.length > 0 && (
          <>
            <h2 className="page-h1" style={{ marginTop: 40 }}>Deletion log</h2>
            <p className="lead">Who removed or restored whom.</p>
            {deletionLog.map((e) => (
              <p key={e.id} className="empty" style={{ margin: '0 0 8px' }}>
                <strong>{e.actor_label ?? 'unknown'}</strong> {ACTION_VERB[e.action]}{' '}
                <strong>{e.target_label ?? 'unknown'}</strong>
                {' · '}
                {new Date(e.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
