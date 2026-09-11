import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Brand, Post } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { listUpcomingPosts, listPostsByStatus } from '@/lib/data/posts';
import { approvePostAction, rejectPostAction } from '@/lib/actions/approvals';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals | Kip' };

function formatWhen(iso: string | null): string {
  if (!iso) return 'Unscheduled';
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function isConnected(b: Brand): boolean {
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}

function WaitingList({ brand, waiting }: { brand: Brand; waiting: Post[] }) {
  if (waiting.length === 0) {
    return <p className="empty">Nothing waiting. Reply yes in the thread.</p>;
  }
  return (
    <ul className="list">
      {waiting.map((p) => (
        <li key={p.id} className="row" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <p className="caption">{p.caption ?? '(no caption yet)'}</p>
          <p className="opt" style={{ fontSize: 13, marginTop: 4 }}>
            {formatWhen(p.scheduled_at)}
          </p>
          <div className="draft-actions">
            <form action={approvePostAction}>
              <input type="hidden" name="postId" value={p.id} />
              <input type="hidden" name="brandId" value={brand.id} />
              <button className="text-btn" type="submit">
                Approve
              </button>
            </form>
            <form action={rejectPostAction}>
              <input type="hidden" name="postId" value={p.id} />
              <input type="hidden" name="brandId" value={brand.id} />
              <button className="text-btn bad" type="submit">
                Remove
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function ApprovalsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.is_admin) redirect('/app/operator');

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const [waiting, upcoming] = await Promise.all([
    listPostsByStatus(brand.id, ['pending_approval']),
    listUpcomingPosts(brand.id, 20),
  ]);

  const connected = isConnected(brand);

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">Approvals</h1>
        <p className="lead">Drafts that need your yes, and what’s already lined up to go out.</p>

        <h2 style={{ margin: '8px 0 4px', fontSize: 19 }}>Needs a yes</h2>
        <WaitingList brand={brand} waiting={waiting} />

        <h2 style={{ margin: '32px 0 4px', fontSize: 19 }}>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="empty">Nothing scheduled.</p>
        ) : (
          upcoming.map((p) => (
            <div key={p.id} className="rrow">
              <span style={{ minWidth: 0, flex: 1 }}>
                {p.caption ? p.caption.slice(0, 72) + (p.caption.length > 72 ? '…' : '') : '(no caption)'}
              </span>
              <span className="opt" style={{ flex: '0 0 auto' }}>
                {formatWhen(p.scheduled_at)}
              </span>
            </div>
          ))
        )}

        {connected ? (
          <p className="empty" style={{ marginTop: 32 }}>
            Posting as {brand.fb_page_name ?? 'your Page'}
            {brand.ig_username ? ` · @${brand.ig_username}` : ''}
          </p>
        ) : (
          <p style={{ marginTop: 32 }}>
            <Link className="pill-dark" href="/app/connections">
              Connect accounts
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
