import { redirect } from 'next/navigation';
import type { Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { setPhoneAction } from '@/lib/actions/connect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connections | Kip' };

const BANNERS: Record<string, Record<string, { text: string; ok: boolean }>> = {
  connect: {
    success: { text: 'Instagram & Facebook connected 🎉', ok: true },
    denied: { text: 'Connection cancelled. You can try again anytime.', ok: false },
    failed: { text: 'Something went wrong connecting. Please try again.', ok: false },
    invalid: { text: 'That link expired. Please start the connection again.', ok: false },
    expired: { text: 'Your connection session expired. Please reconnect.', ok: false },
    nopages: { text: 'No Facebook Pages found. You need a Page with a linked Instagram to post.', ok: false },
  },
  phone: {
    saved: { text: 'Phone number saved. Kip will be in touch.', ok: true },
    invalid: { text: 'That doesn’t look like a valid mobile number (e.g. 04xx xxx xxx).', ok: false },
    taken: { text: 'That number is already linked to another account.', ok: false },
  },
  x: {
    success: { text: 'X connected 🎉', ok: true },
    denied: { text: 'X connection cancelled.', ok: false },
    failed: { text: 'Something went wrong connecting X.', ok: false },
    unconfigured: { text: 'X connect isn’t switched on yet. Hang tight.', ok: false },
  },
  threads: {
    success: { text: 'Threads connected 🎉', ok: true },
    denied: { text: 'Threads connection cancelled.', ok: false },
    failed: { text: 'Something went wrong connecting Threads.', ok: false },
    unconfigured: { text: 'Threads connect isn’t switched on yet. Hang tight.', ok: false },
  },
};

function isConnected(b: Brand): boolean {
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}
function hasRealPhone(b: Brand): boolean {
  return Boolean(b.client_phone && !b.client_phone.startsWith('signup:'));
}

/** Plain-language labels for the connected Meta accounts (IG + Facebook Page). */
function metaAccountSummary(b: Brand): string {
  const parts: string[] = [];
  if (b.ig_username) parts.push(`Instagram @${b.ig_username}`);
  else if (b.ig_user_id) parts.push('Instagram');
  if (b.fb_page_name) parts.push(`Facebook Page “${b.fb_page_name}”`);
  else if (b.fb_page_id) parts.push('Facebook Page');
  return parts.join(' · ') || 'Connected';
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; phone?: string; x?: string; threads?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const sp = await searchParams;
  const banners = (['connect', 'phone', 'x', 'threads'] as const)
    .map((k) => {
      const code = sp[k];
      return code ? BANNERS[k]?.[code] : undefined;
    })
    .filter((b): b is { text: string; ok: boolean } => Boolean(b));

  const connected = isConnected(brand);
  const phoneSet = hasRealPhone(brand);

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">Connections</h1>
        <p className="lead">Kip asks before it alters anything. Connect the places it may post.</p>

        {banners.map((b, i) => (
          <p key={i} className={`banner ${b.ok ? 'ok' : 'bad'}`}>{b.text}</p>
        ))}

        <article className="row">
          <div className="setup-head">
            <span>Instagram &amp; Facebook</span>
            <span className={connected ? 'done' : 'need'}>
              {connected
                ? brand.ig_username
                  ? `@${brand.ig_username}`
                  : brand.fb_page_name ?? 'Connected'
                : 'Needs you'}
            </span>
          </div>
          <p className="empty">
            {connected
              ? metaAccountSummary(brand)
              : 'Sign in with Facebook and choose the Page Kip should post to.'}
          </p>
          <p>
            <a className="pill-dark" href="/api/connect/facebook/start">
              {connected ? 'Reconnect' : 'Connect with Facebook'}
            </a>
          </p>
        </article>

        <article className="row">
          <div className="setup-head">
            <span>Phone</span>
            <span className={phoneSet ? 'done' : 'need'}>{phoneSet ? 'Done' : 'Needs you'}</span>
          </div>
          <p className="empty">You text a photo, Kip drafts the post, you reply “yes”.</p>
          <form className="quiet-form" action={setPhoneAction}>
            <input name="phone" inputMode="tel" required placeholder="04xx xxx xxx" defaultValue={phoneSet ? brand.client_phone : ''} />
            <button className="pill-dark" type="submit">{phoneSet ? 'Update' : 'Save number'}</button>
          </form>
        </article>

        <article className="row">
          <div className="setup-head">
            <span>X (optional)</span>
            <span className={brand.x_username ? 'done' : 'need'}>
              {brand.x_username ? `@${brand.x_username}` : 'Off'}
            </span>
          </div>
          <p className="empty">
            {brand.x_username
              ? `Connected as @${brand.x_username}.`
              : 'Optional. Connect an X account Kip may post to.'}
          </p>
          <p>
            <a className="pill-dark" href="/api/connect/x/start">{brand.x_username ? 'Reconnect' : 'Connect X'}</a>
          </p>
        </article>

        <article className="row">
          <div className="setup-head">
            <span>Threads (optional)</span>
            <span className={brand.threads_username ? 'done' : 'need'}>
              {brand.threads_username ? `@${brand.threads_username}` : 'Off'}
            </span>
          </div>
          <p className="empty">
            {brand.threads_username
              ? `Connected as @${brand.threads_username}.`
              : 'Optional. Connect a Threads account Kip may post to.'}
          </p>
          <p>
            <a className="pill-dark" href="/api/connect/threads/start">
              {brand.threads_username ? 'Reconnect' : 'Connect Threads'}
            </a>
          </p>
        </article>
      </div>
    </section>
  );
}
