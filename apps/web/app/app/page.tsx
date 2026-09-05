import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { listBrands, listBrandsForOwner } from '@/lib/data/brands';
import { setPhoneAction } from '@/lib/actions/connect';
import type { Brand, OnboardingStatus } from '@pulse/shared';

export const dynamic = 'force-dynamic';

const CONNECT_MSG: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Instagram & Facebook connected 🎉', ok: true },
  denied: { text: 'Connection cancelled — you can try again anytime.', ok: false },
  failed: { text: 'Something went wrong connecting — please try again.', ok: false },
  invalid: { text: 'That link expired — please start the connection again.', ok: false },
  expired: { text: 'Your connection session expired — please reconnect.', ok: false },
  nopages: { text: 'No Facebook Pages found on that account. You need a Page (with a linked Instagram) to post.', ok: false },
  nobrand: { text: 'We couldn’t find your account — please contact support.', ok: false },
};

const PHONE_MSG: Record<string, { text: string; ok: boolean }> = {
  saved: { text: 'Phone number saved — your agent will be in touch.', ok: true },
  invalid: { text: 'That doesn’t look like a valid mobile number — try again (e.g. 04xx xxx xxx).', ok: false },
  taken: { text: 'That number is already linked to another account.', ok: false },
};

const GOOGLE_MSG: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Google Business Profile connected 🎉', ok: true },
  denied: { text: 'Google connection cancelled — you can try again anytime.', ok: false },
  failed: { text: 'Something went wrong connecting Google — please try again.', ok: false },
  invalid: { text: 'That link expired — please start the Google connection again.', ok: false },
  expired: { text: 'Your Google session expired — please reconnect.', ok: false },
  unconfigured: { text: 'Google connect isn’t switched on yet — hang tight.', ok: false },
  norefresh: { text: 'Google didn’t grant lasting access — please reconnect and allow offline access.', ok: false },
  nolocations: { text: 'No Google Business Profile locations found on that account.', ok: false },
  nobrand: { text: 'We couldn’t find your account — please contact support.', ok: false },
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
    <p
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        marginBottom: 16,
        background: msg.ok ? '#e8f8ef' : '#fdecea',
        color: msg.ok ? '#1e7e46' : '#c0392b',
        border: `1px solid ${msg.ok ? '#bfe8cf' : '#f5c6c0'}`,
      }}
    >
      {msg.text}
    </p>
  );
}

function StepCard({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 30,
          height: 30,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          color: done ? '#fff' : '#555',
          background: done ? '#1e7e46' : '#ececf1',
        }}
      >
        {done ? '✓' : n}
      </div>
      <div style={{ flex: 1 }}>
        <h2 style={{ margin: '2px 0 8px', fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function setupLabel(status: OnboardingStatus | undefined): string {
  switch (status) {
    case 'pending':
      return 'Your agent is about to message you to finish setup.';
    case 'in_progress':
      return 'Setup in progress — reply to the agent to finish.';
    case 'done':
      return 'All set. Send a photo anytime and your agent drafts a post.';
    default:
      return 'Add your number and your agent will reach out to get started.';
  }
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; phone?: string; google?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Admin (operator) sees every brand.
  if (user!.is_admin) {
    const brands = await listBrands();
    return (
      <section>
        <div className="page-header">
          <h1>All brands</h1>
          <Link href="/app/brands/new" className="btn-primary">Add brand</Link>
        </div>
        {brands.length === 0 ? (
          <p className="empty">No brands yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Owner</th><th>Connected</th><th>Setup</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.owner_user_id ? 'user' : '—'}</td>
                  <td>{b.fb_page_id ? (b.ig_username ? `@${b.ig_username}` : 'FB page') : '—'}</td>
                  <td>{b.onboarding_state?.status ?? 'none'}</td>
                  <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                  <td><Link href={`/app/brands/${b.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  const { connect, phone, google } = await searchParams;
  const brands = await listBrandsForOwner(user!.id);
  const brand = brands[0];

  if (!brand) {
    return (
      <section>
        <div className="page-header"><h1>Your agent</h1></div>
        <p className="empty">We’re setting up your account…</p>
      </section>
    );
  }

  const connected = isConnected(brand);
  const phoneSet = hasRealPhone(brand);
  const allDone = connected && phoneSet;

  return (
    <section>
      <div className="page-header">
        <h1>{allDone ? 'Your agent' : 'Finish setting up'}</h1>
      </div>

      <Banner msg={connect ? CONNECT_MSG[connect] : undefined} />
      <Banner msg={phone ? PHONE_MSG[phone] : undefined} />
      <Banner msg={google ? GOOGLE_MSG[google] : undefined} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepCard n={1} title="Connect Instagram & Facebook" done={connected}>
          {connected ? (
            <p style={{ margin: 0, color: 'var(--muted, #667)' }}>
              Connected to <strong>{brand.fb_page_name ?? 'your Page'}</strong>
              {brand.ig_username ? <> · Instagram <strong>@{brand.ig_username}</strong></> : null}.{' '}
              <a href="/api/connect/facebook/start">Reconnect</a>
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
                Sign in with Facebook and choose the Page your agent should post to. Your Instagram
                links automatically if it’s connected to that Page.
              </p>
              <a className="btn-primary" href="/api/connect/facebook/start">Connect with Facebook</a>
            </>
          )}
        </StepCard>

        <StepCard n={2} title="Add your mobile number" done={phoneSet}>
          {phoneSet ? (
            <p style={{ margin: 0, color: 'var(--muted, #667)' }}>
              We’ll reach you on <strong>{brand.client_phone}</strong>.{' '}
              <span style={{ fontSize: 13 }}>Wrong number? Update it below.</span>
            </p>
          ) : (
            <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
              This is how your agent works — you text it a photo, it drafts the post, you reply “yes”.
            </p>
          )}
          <form action={setPhoneAction} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input
              name="phone"
              inputMode="tel"
              placeholder="04xx xxx xxx"
              defaultValue={phoneSet ? brand.client_phone : ''}
              required
              style={{ flex: '1 1 220px', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border,#d9d9e0)' }}
            />
            <button className="btn-primary" type="submit">{phoneSet ? 'Update' : 'Save number'}</button>
          </form>
        </StepCard>

        <StepCard n={3} title="Your agent takes it from here" done={brand.onboarding_state?.status === 'done'}>
          <p style={{ margin: 0, color: 'var(--muted, #667)' }}>{setupLabel(brand.onboarding_state?.status)}</p>
        </StepCard>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Google Business Profile <span style={{ fontSize: 13, color: 'var(--muted,#667)', fontWeight: 400 }}>(optional)</span></h2>
        {brand.gbp_location_id ? (
          <p style={{ margin: 0, color: 'var(--muted, #667)' }}>
            Connected to <strong>{brand.gbp_location_name ?? 'your location'}</strong> — the agent can post to Google and handle your reviews.{' '}
            <a href="/api/connect/google/start">Reconnect</a>
          </p>
        ) : (
          <>
            <p style={{ marginTop: 0, color: 'var(--muted, #667)' }}>
              Connect your Google Business Profile so the agent posts to Google and replies to your Google reviews — big for local discovery.
            </p>
            <a className="btn-primary" href="/api/connect/google/start">Connect Google</a>
          </>
        )}
      </div>

      {allDone && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link href={`/app/brands/${brand.id}/voice`}>Edit brand voice</Link>
            <Link href={`/app/brands/${brand.id}`}>Approvals</Link>
            <Link href={`/app/brands/${brand.id}/history`}>Post history</Link>
          </div>
        </div>
      )}
    </section>
  );
}
