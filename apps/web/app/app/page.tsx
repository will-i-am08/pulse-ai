import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicMediaUrl, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { listRecentMessages } from '@/lib/data/messages';
import { getBrandPerformance, listPostsByStatus, type BrandPerformance } from '@/lib/data/posts';
import type { ThreadMessageDto } from '@/lib/thread';
import { LiveThread } from './LiveThread';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Thread | Kip' };

const CONNECT_MSG: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Instagram & Facebook connected 🎉', ok: true },
  denied: { text: 'Connection cancelled. You can try again anytime.', ok: false },
  failed: { text: 'Something went wrong connecting. Please try again.', ok: false },
  invalid: { text: 'That link expired. Please start the connection again.', ok: false },
  expired: { text: 'Your connection session expired. Please reconnect.', ok: false },
  nopages: { text: 'No Facebook Pages found. You need a Page with a linked Instagram to post.', ok: false },
  nobrand: { text: 'We couldn’t find your account. Please contact support.', ok: false },
};
const PHONE_MSG: Record<string, { text: string; ok: boolean }> = {
  saved: { text: 'Phone number saved. Kip will be in touch.', ok: true },
  invalid: { text: 'That doesn’t look like a valid mobile number (e.g. 04xx xxx xxx).', ok: false },
  taken: { text: 'That number is already linked to another account.', ok: false },
};

function isConnected(b: Brand): boolean {
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function formatPosted(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

function MetricsAside({
  brand,
  performance,
  waitingCount,
  banner,
}: {
  brand: Brand;
  performance: BrandPerformance;
  waitingCount: number;
  banner?: { text: string; ok: boolean };
}) {
  const connected = isConnected(brand);
  const hasEngagement =
    performance.likes + performance.comments + performance.reach + performance.saves + performance.shares > 0;

  return (
    <aside className="aside">
      {banner && <p className={`banner ${banner.ok ? 'ok' : 'bad'}`}>{banner.text}</p>}

      <h2>Last {performance.days} days</h2>
      <div className="metric-grid metric-block">
        <div className="metric">
          <span className="metric-val">{formatCompact(performance.postsPublished)}</span>
          <span className="metric-lbl">Posts</span>
        </div>
        <div className="metric">
          <span className="metric-val">{formatCompact(performance.reach)}</span>
          <span className="metric-lbl">Views / reach</span>
        </div>
        <div className="metric">
          <span className="metric-val">{formatCompact(performance.likes)}</span>
          <span className="metric-lbl">Likes</span>
        </div>
        <div className="metric">
          <span className="metric-val">{formatCompact(performance.comments)}</span>
          <span className="metric-lbl">Comments</span>
        </div>
        {(performance.saves > 0 || performance.shares > 0) && (
          <>
            <div className="metric">
              <span className="metric-val">{formatCompact(performance.saves)}</span>
              <span className="metric-lbl">Saves</span>
            </div>
            <div className="metric">
              <span className="metric-val">{formatCompact(performance.shares)}</span>
              <span className="metric-lbl">Shares</span>
            </div>
          </>
        )}
      </div>

      {!hasEngagement && performance.postsPublished === 0 && (
        <p className="empty">No published posts yet. Metrics show up once Kip posts go live.</p>
      )}
      {!hasEngagement && performance.postsPublished > 0 && (
        <p className="empty">Posts are live — engagement numbers appear as they come in.</p>
      )}

      {performance.topPosts.length > 0 && hasEngagement && (
        <>
          <h2>Top posts</h2>
          <div className="metric-block">
            {performance.topPosts.map((p) => (
              <div key={p.id} className="metric-post">
                <p className="caption">{p.caption?.trim() || '(no caption)'}</p>
                <p className="opt">
                  {formatPosted(p.published_at)}
                  {p.reach > 0 ? ` · ${formatCompact(p.reach)} reach` : ''}
                  {p.likes > 0 ? ` · ${formatCompact(p.likes)} likes` : ''}
                  {p.comments > 0 ? ` · ${formatCompact(p.comments)} comments` : ''}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Approvals</h2>
      {waitingCount === 0 ? (
        <p className="empty">
          Nothing waiting.{' '}
          <Link href="/app/approvals" style={{ color: 'inherit' }}>
            View upcoming
          </Link>
        </p>
      ) : (
        <p className="empty" style={{ margin: 0 }}>
          <Link className="pill-dark" href="/app/approvals">
            {waitingCount} need{waitingCount === 1 ? 's' : ''} a yes
          </Link>
        </p>
      )}

      {connected ? (
        <p className="empty" style={{ marginTop: 24 }}>
          {brand.fb_page_name ?? 'your Page'}
          {brand.ig_username ? ` · @${brand.ig_username}` : ''}
        </p>
      ) : (
        <p style={{ marginTop: 24 }}>
          <Link className="pill-dark" href="/app/connections">
            Connect accounts
          </Link>
        </p>
      )}
    </aside>
  );
}

export default async function ThreadHome({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; phone?: string; chat?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.is_admin) redirect('/app/operator');

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];

  if (!brand) {
    return (
      <section className="stage">
        <div className="page">
          <h1 className="page-h1">Setting up</h1>
          <p className="lead">We’re setting up your account. Kip will message you to finish.</p>
        </div>
      </section>
    );
  }

  const { connect, phone, chat } = await searchParams;
  const banner = connect
    ? CONNECT_MSG[connect]
    : phone
      ? PHONE_MSG[phone]
      : chat === 'nochannel'
        ? { text: 'Add your phone in Connections so Kip has somewhere to reply.', ok: false }
        : undefined;

  const [messages, performance, waiting] = await Promise.all([
    listRecentMessages(brand.id, 40),
    getBrandPerformance(brand.id, 30),
    listPostsByStatus(brand.id, ['pending_approval']),
  ]);

  const initialMessages: ThreadMessageDto[] = messages.map((m) => ({
    id: m.id,
    direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
    body: m.body,
    mediaUrl: m.media_ids[0] ? publicMediaUrl(m.media_ids[0]) : null,
    createdAt: m.created_at,
  }));

  return (
    <>
      <LiveThread firstName={user.name?.split(' ')[0] ?? null} initialMessages={initialMessages} />
      <MetricsAside
        brand={brand}
        performance={performance}
        waitingCount={waiting.length}
        banner={banner}
      />
    </>
  );
}
