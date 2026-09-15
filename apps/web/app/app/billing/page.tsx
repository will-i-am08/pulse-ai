import { redirect } from 'next/navigation';
import { canAccessBillingPortal, hasPaidAccess } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { createPortalSessionAction } from '@/lib/actions/billing';
import { isStripeTestMode } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing | Kip' };

const ERRORS: Record<string, string> = {
  nocustomer: 'No Stripe customer on this account yet — pay from Checkout first.',
  unavailable: 'Billing portal isn’t available right now.',
  portal: 'Couldn’t open the Stripe billing portal. Try again.',
};

function statusLabel(status: string | undefined, complimentary: boolean | undefined): string {
  if (complimentary) return 'Complimentary';
  switch (status) {
    case 'active':
      return 'Active';
    case 'past_due':
      return 'Past due — we’ll retry the card';
    case 'canceled':
      return 'Canceled';
    case 'unpaid':
      return 'Unpaid';
    case 'incomplete':
      return 'Incomplete';
    default:
      return 'No paid subscription';
  }
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const facts = brand.facts ?? null;
  if (!canAccessBillingPortal(facts, { isAdmin: user.is_admin })) {
    redirect('/payment');
  }

  const { error } = await searchParams;
  const payment = facts?.payment;
  const plan = facts?.plan ?? facts?.plan_preference;
  const paid = hasPaidAccess(facts, { isAdmin: user.is_admin });
  const pastDue = payment?.status === 'past_due';

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">Billing</h1>
        <p className="lead">Manage your Kip plan in Stripe. Prices are AUD, inc. GST.</p>

        {error && <p className="banner bad">{ERRORS[error] ?? 'Something went wrong.'}</p>}
        {isStripeTestMode() && (
          <p className="banner">Stripe test mode — changes here do not charge a real card.</p>
        )}
        {pastDue && (
          <p className="banner bad">
            The last invoice didn’t go through. Update your card in the portal — access stays on
            while Stripe retries.
          </p>
        )}
        {!paid && payment?.status === 'canceled' && (
          <p className="banner bad">
            Your subscription has ended. Reopen the portal to resubscribe, or start Checkout again.
          </p>
        )}

        <article className="row">
          <div className="setup-head">
            <span>Plan</span>
            <span className={paid ? 'done' : 'need'}>
              {statusLabel(payment?.status, payment?.complimentary)}
            </span>
          </div>
          <p className="empty">
            {plan
              ? `${plan.tier === 'max' ? 'Max' : 'Pro'} · ${plan.interval === 'year' ? 'annual' : 'monthly'}`
              : 'No plan selected yet.'}
            {payment?.current_period_end
              ? ` · current period ends ${new Date(payment.current_period_end).toLocaleDateString('en-AU', {
                  timeZone: 'Australia/Sydney',
                })}`
              : ''}
            {payment?.cancel_at_period_end ? ' · cancels at period end' : ''}
            {payment?.discount?.percent_off
              ? ` · ${payment.discount.percent_off}% off (${payment.discount.duration ?? 'applied'})`
              : ''}
          </p>
          {payment?.stripe_customer_id ? (
            <form action={createPortalSessionAction}>
              <button className="pill-dark" type="submit">
                Open billing portal
              </button>
            </form>
          ) : (
            <p>
              <a className="pill-dark" href="/payment">
                Choose a plan
              </a>
            </p>
          )}
        </article>

        <p className="empty" style={{ marginTop: 16 }}>
          Cancel anytime — access continues through the period already billed. First-week refunds:
          email{' '}
          <a href="mailto:will@jmcalder.com">will@jmcalder.com</a> within seven days of your first
          charge.
        </p>
      </div>
    </section>
  );
}
