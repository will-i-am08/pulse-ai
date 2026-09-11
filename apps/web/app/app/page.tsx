import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicMediaUrl, type Brand, type Post } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { listRecentMessages } from '@/lib/data/messages';
import { listUpcomingPosts, listPostsByStatus } from '@/lib/data/posts';
import { approvePostAction, rejectPostAction } from '@/lib/actions/approvals';
import { PreviewComposer } from './PreviewComposer';

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

function Aside({
  brand,
  waiting,
  upcoming,
  banner,
}: {
  brand: Brand;
  waiting: Post[];
  upcoming: Post[];
  banner?: { text: string; ok: boolean };
}) {
  const connected = isConnected(brand);
  return (
    <aside className="aside">
      {banner && <p className={`banner ${banner.ok ? 'ok' : 'bad'}`}>{banner.text}</p>}

      <h2>Needs a yes</h2>
      {waiting.length === 0 ? (
        <p className="empty">Nothing waiting. Reply yes in the thread.</p>
      ) : (
        waiting.map((p) => (
          <div key={p.id} style={{ marginBottom: 16 }}>
            <p className="caption">{p.caption ?? '(no caption yet)'}</p>
            <p className="opt" style={{ fontSize: 13 }}>{formatWhen(p.scheduled_at)}</p>
            <div className="draft-actions">
              <form action={approvePostAction}>
                <input type="hidden" name="postId" value={p.id} />
                <input type="hidden" name="brandId" value={brand.id} />
                <button className="text-btn" type="submit">Approve</button>
              </form>
              <form action={rejectPostAction}>
                <input type="hidden" name="postId" value={p.id} />
                <input type="hidden" name="brandId" value={brand.id} />
                <button className="text-btn bad" type="submit">Remove</button>
              </form>
            </div>
          </div>
        ))
      )}

      <h2 style={{ marginTop: 28 }}>Upcoming</h2>
      {upcoming.length === 0 ? (
        <p className="empty">Nothing scheduled.</p>
      ) : (
        upcoming.map((p) => (
          <div key={p.id} className="rrow">
            <span>{formatWhen(p.scheduled_at)}</span>
          </div>
        ))
      )}

      {connected ? (
        <p className="empty" style={{ marginTop: 24 }}>
          {brand.fb_page_name ?? 'your Page'}
          {brand.ig_username ? ` · @${brand.ig_username}` : ''}
        </p>
      ) : (
        <p style={{ marginTop: 24 }}>
          <Link className="pill-dark" href="/app/connections">Connect accounts</Link>
        </p>
      )}
    </aside>
  );
}

export default async function ThreadHome({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; phone?: string }>;
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

  const { connect, phone } = await searchParams;
  const banner = connect ? CONNECT_MSG[connect] : phone ? PHONE_MSG[phone] : undefined;

  const [messages, upcoming, waiting] = await Promise.all([
    listRecentMessages(brand.id, 40),
    listUpcomingPosts(brand.id),
    listPostsByStatus(brand.id, ['pending_approval']),
  ]);

  return (
    <>
      <section className="stage">
        <div className="chat">
          {messages.length === 0 ? (
            <div className="bubble kip">
              <p>
                Hi{user.name ? ` ${user.name.split(' ')[0]}` : ''} — I’m Kip. Text me a photo from the
                floor and I’ll draft a post in your voice. Nothing goes out without your yes.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.direction === 'inbound';
              const img = m.media_ids[0] ? publicMediaUrl(m.media_ids[0]) : null;
              return (
                <div key={m.id} className={`bubble ${mine ? 'you' : 'kip'}`}>
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" />
                  )}
                  {m.body && <p>{m.body}</p>}
                </div>
              );
            })
          )}
        </div>
        <div className="dock">
          <PreviewComposer
            placeholder="Tell Kip what to post, or drop a photo…"
            note="In-app sending isn’t wired up yet — reply in your SMS or Discord thread and Kip will pick it up. Approvals here work now."
          />
        </div>
      </section>
      <Aside brand={brand} waiting={waiting} upcoming={upcoming} banner={banner} />
    </>
  );
}
