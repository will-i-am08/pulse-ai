import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { listBrands, listBrandsForOwner } from '@/lib/data/brands';
import { listPostsByStatus, listUpcomingPosts } from '@/lib/data/posts';
import { setPhoneAction } from '@/lib/actions/connect';
import type { Brand, OnboardingStatus, Post } from '@pulse/shared';
import styles from './dash.module.css';

export const dynamic = 'force-dynamic';

const CONNECT_MSG: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Instagram & Facebook connected 🎉', ok: true },
  denied: { text: 'Connection cancelled. You can try again anytime.', ok: false },
  failed: { text: 'Something went wrong connecting. Please try again.', ok: false },
  invalid: { text: 'That link expired. Please start the connection again.', ok: false },
  expired: { text: 'Your connection session expired. Please reconnect.', ok: false },
  nopages: { text: 'No Facebook Pages found on that account. You need a Page (with a linked Instagram) to post.', ok: false },
  nobrand: { text: 'We couldn’t find your account. Please contact support.', ok: false },
};

const PHONE_MSG: Record<string, { text: string; ok: boolean }> = {
  saved: { text: 'Phone number saved. Your agent will be in touch.', ok: true },
  invalid: { text: 'That doesn’t look like a valid mobile number. Try again (e.g. 04xx xxx xxx).', ok: false },
  taken: { text: 'That number is already linked to another account.', ok: false },
};

function isConnected(b: Brand): boolean {
  // A Page + a stored publish token + a linked Instagram account (publishing runs
  // through IG today, so a Page with no IG isn't really "connected").
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}
function hasRealPhone(b: Brand): boolean {
  return Boolean(b.client_phone && !b.client_phone.startsWith('signup:'));
}

function Banner({ msg }: { msg?: { text: string; ok: boolean } }) {
  if (!msg) return null;
  return (
    <p className={`${styles.banner} ${msg.ok ? styles.bannerOk : styles.bannerBad}`}>{msg.text}</p>
  );
}

function setupLabel(status: OnboardingStatus | undefined): string {
  switch (status) {
    case 'pending':
      return 'Your agent is about to message you to finish setup.';
    case 'in_progress':
      return 'Setup in progress. Reply to the agent to finish.';
    case 'done':
      return 'All set. Send a photo anytime and your agent drafts a post.';
    default:
      return 'Add your number and your agent will reach out to get started.';
  }
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

function PostRows({ posts, empty }: { posts: Post[]; empty: string }) {
  if (posts.length === 0) {
    return <p className={styles.empty}>{empty}</p>;
  }
  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.id} className={styles.row}>
          <span className={styles.when}>{formatWhen(post.scheduled_at)}</span>
          <p className={styles.caption}>{post.caption ?? '(no caption yet)'}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; phone?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Admin (operator) sees every brand.
  if (user!.is_admin) {
    const brands = await listBrands();
    return (
      <section>
        <div className={styles.operatorHead}>
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
                <th>Connected</th>
                <th>Setup</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.owner_user_id ? 'user' : '-'}</td>
                  <td>{b.fb_page_id ? (b.ig_username ? `@${b.ig_username}` : 'FB page') : '-'}</td>
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

  const { connect, phone } = await searchParams;
  const brands = await listBrandsForOwner(user!.id);
  const brand = brands[0];

  if (!brand) {
    return (
      <section className={styles.home}>
        <article className={styles.panel}>
          <h2>Status</h2>
          <p className={styles.status}>Still setting up</p>
          <p className={styles.statusDetail}>We’re setting up your account…</p>
        </article>
      </section>
    );
  }

  const connected = isConnected(brand);
  const phoneSet = hasRealPhone(brand);
  const allDone = connected && phoneSet;
  const [upcoming, waiting] = await Promise.all([
    listUpcomingPosts(brand.id),
    listPostsByStatus(brand.id, ['pending_approval']),
  ]);

  return (
    <section className={styles.home}>
      <Banner msg={connect ? CONNECT_MSG[connect] : undefined} />
      <Banner msg={phone ? PHONE_MSG[phone] : undefined} />

      <article className={styles.panel}>
        <h2>Status</h2>
        {connected ? (
          <>
            <p className={styles.status}>Connected</p>
            <p className={styles.statusDetail}>
              {brand.fb_page_name ?? 'your Page'}
              {brand.ig_username ? ` · @${brand.ig_username}` : ''}
            </p>
          </>
        ) : (
          <>
            <p className={styles.status}>Still setting up</p>
            <p className={styles.statusDetail}>{setupLabel(brand.onboarding_state?.status)}</p>
          </>
        )}
      </article>

      {!allDone && (
        <article className={styles.panel}>
          <h2>Setup</h2>
          <ul className={styles.setupList}>
            <li className={styles.setupItem}>
              <div className={styles.setupHead}>
                <span>Connect Facebook</span>
                <span className={connected ? styles.done : styles.need}>
                  {connected ? 'Done' : 'Needs you'}
                </span>
              </div>
              {connected ? (
                <p className={styles.empty}>
                  {brand.fb_page_name ?? 'your Page'}
                  {brand.ig_username ? ` · @${brand.ig_username}` : ''}.{' '}
                  <a href="/api/connect/facebook/start">Reconnect</a>
                </p>
              ) : (
                <>
                  <p className={styles.empty}>
                    Sign in with Facebook and choose the Page your agent should post to.
                  </p>
                  <a className="btn-primary" href="/api/connect/facebook/start">
                    Connect with Facebook
                  </a>
                </>
              )}
            </li>
            <li className={styles.setupItem}>
              <div className={styles.setupHead}>
                <span>Add your phone</span>
                <span className={phoneSet ? styles.done : styles.need}>
                  {phoneSet ? 'Done' : 'Needs you'}
                </span>
              </div>
              {phoneSet ? (
                <p className={styles.empty}>We’ll reach you on {brand.client_phone}.</p>
              ) : (
                <p className={styles.empty}>
                  This is how your agent works. You text it a photo, it drafts the post, you reply
                  “yes”.
                </p>
              )}
              <form action={setPhoneAction} className={styles.quietForm}>
                <input
                  name="phone"
                  inputMode="tel"
                  placeholder="04xx xxx xxx"
                  defaultValue={phoneSet ? brand.client_phone : ''}
                  required
                />
                <button className="btn-primary" type="submit">
                  {phoneSet ? 'Update' : 'Save number'}
                </button>
              </form>
            </li>
          </ul>
        </article>
      )}

      <article className={styles.panel}>
        <h2>Upcoming</h2>
        <PostRows posts={upcoming} empty="Nothing scheduled yet." />
      </article>

      <article className={styles.panel}>
        <h2>Needs a yes</h2>
        <p className={styles.yesCount}>
          {waiting.length === 0
            ? 'Nothing waiting'
            : waiting.length === 1
              ? '1 draft waiting'
              : `${waiting.length} drafts waiting`}
        </p>
        {waiting.length > 0 ? <PostRows posts={waiting} empty="" /> : null}
        <p className={styles.threadHint}>Reply yes in your text thread to approve. Nothing posts without it.</p>
      </article>
    </section>
  );
}
