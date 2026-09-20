import type { Brand, BusinessFacts } from '@pulse/shared';
import {
  operatorApplyDiscountAction,
  operatorChangePlanAction,
  operatorRefundAction,
  operatorSetComplimentaryAction,
  loadLatestPaidInvoice,
} from '@/lib/actions/operator-billing';

function moneyAud(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

const OK_DETAILS: Record<string, string> = {
  'complimentary-on': 'Account is now complimentary (not billed).',
  'complimentary-off': 'Complimentary access removed.',
  discount: 'Discount applied in Stripe.',
  plan: 'Plan updated.',
  refund: 'Refund issued in Stripe.',
};

const ERR_DETAILS: Record<string, string> = {
  comp: 'Couldn’t change complimentary access.',
  nocustomer: 'This brand has no Stripe customer yet.',
  unavailable: 'Stripe isn’t configured in this environment.',
  'discount-percent': 'Percent off must be 1–100.',
  discount: 'Couldn’t apply the discount.',
  plan: 'Couldn’t change the plan.',
  'plan-item': 'Stripe subscription has no items to update.',
  'refund-confirm': 'Tick the confirm box to refund.',
  'refund-amount': 'Enter a valid refund amount.',
  noinvoice: 'No paid invoice to refund.',
  refund: 'Refund failed in Stripe.',
};

export default async function OperatorBillingPanel({
  brand,
  ownerUserId,
  notice,
}: {
  brand: Brand;
  ownerUserId: string;
  notice?: { ok: boolean; detail?: string };
}) {
  const facts: BusinessFacts = brand.facts ?? {};
  const payment = facts.payment;
  const plan = facts.plan ?? facts.plan_preference;
  const invoice = payment?.stripe_customer_id
    ? await loadLatestPaidInvoice(payment.stripe_customer_id)
    : null;

  const msg = notice?.detail
    ? (notice.ok ? OK_DETAILS : ERR_DETAILS)[notice.detail] ??
      (notice.ok ? 'Saved.' : 'That didn’t work.')
    : null;

  return (
    <div style={{ marginTop: 40 }}>
      <h2 className="page-h1" style={{ fontSize: 22 }}>
        Billing
      </h2>
      <p className="lead">
        Discounts, refunds, complimentary access, and remote plan changes. Money movement goes
        through Stripe.
      </p>

      {msg && (
        <p className={`banner ${notice?.ok ? 'ok' : 'bad'}`} role="status">
          {msg}
        </p>
      )}

      <article className="row">
        <div className="setup-head">
          <span>Status</span>
          <span className={payment?.complimentary || payment?.status === 'active' ? 'done' : 'need'}>
            {payment?.complimentary ? 'Complimentary' : payment?.status ?? 'none'}
          </span>
        </div>
        <p className="empty" style={{ margin: '8px 0 0' }}>
          Plan: {plan ? `${plan.tier} / ${plan.interval}` : '—'}
          {payment?.stripe_customer_id ? ` · customer ${payment.stripe_customer_id}` : ' · no Stripe customer'}
          {payment?.stripe_subscription_id ? ` · sub ${payment.stripe_subscription_id}` : ''}
          {payment?.stripe_price_id ? ` · price ${payment.stripe_price_id}` : ''}
          {payment?.discount?.percent_off
            ? ` · ${payment.discount.percent_off}% off (${payment.discount.duration ?? 'coupon'})`
            : ''}
        </p>
        {payment?.last_operator_action && (
          <p className="empty">
            Last operator action: {payment.last_operator_action.action}
            {payment.last_operator_action.note ? ` — ${payment.last_operator_action.note}` : ''}{' '}
            at {new Date(payment.last_operator_action.at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
          </p>
        )}
      </article>

      <article className="row" style={{ marginTop: 16 }}>
        <div className="setup-head">
          <span>Complimentary (free)</span>
        </div>
        <p className="empty">
          Keeps dashboard + SMS access without charging. Pauses Stripe collection if a subscription
          exists; does not delete the customer.
        </p>
        <form action={operatorSetComplimentaryAction} className="quiet-form" style={{ flexWrap: 'wrap' }}>
          <input type="hidden" name="userId" value={ownerUserId} />
          <input type="hidden" name="enable" value={payment?.complimentary ? '0' : '1'} />
          {!payment?.complimentary && (
            <input name="reason" placeholder="Reason (optional)" defaultValue="" />
          )}
          <button className="pill-dark" type="submit">
            {payment?.complimentary ? 'Revoke complimentary' : 'Make account free'}
          </button>
        </form>
      </article>

      <article className="row" style={{ marginTop: 16 }}>
        <div className="setup-head">
          <span>Change plan</span>
        </div>
        <p className="empty">
          Updates facts immediately. If they have a Stripe subscription, the price is swapped with
          proration.
        </p>
        <form action={operatorChangePlanAction} className="quiet-form" style={{ flexWrap: 'wrap' }}>
          <input type="hidden" name="userId" value={ownerUserId} />
          <select name="tier" defaultValue={plan?.tier ?? 'pro'} aria-label="Plan">
            <option value="pro">Pro</option>
            <option value="max">Max</option>
          </select>
          <select name="interval" defaultValue={plan?.interval ?? 'month'} aria-label="Interval">
            <option value="month">Monthly</option>
            <option value="year">Annual</option>
          </select>
          <button className="pill-dark" type="submit">
            Update plan
          </button>
        </form>
      </article>

      <article className="row" style={{ marginTop: 16 }}>
        <div className="setup-head">
          <span>Discount</span>
        </div>
        <p className="empty">
          Creates a Stripe coupon. Applied to a live subscription now, or to their next Checkout
          session if they don’t have one yet.
        </p>
        <form action={operatorApplyDiscountAction} className="quiet-form" style={{ flexWrap: 'wrap' }}>
          <input type="hidden" name="userId" value={ownerUserId} />
          <input
            name="percent_off"
            type="number"
            min={1}
            max={100}
            defaultValue={20}
            aria-label="Percent off"
            style={{ width: 88 }}
          />
          <span className="empty">% off</span>
          <select name="duration" defaultValue="forever" aria-label="Duration">
            <option value="forever">Forever</option>
            <option value="once">Once (next invoice)</option>
            <option value="repeating">Repeating months</option>
          </select>
          <input
            name="duration_in_months"
            type="number"
            min={1}
            max={24}
            defaultValue={3}
            aria-label="Months if repeating"
            style={{ width: 72 }}
          />
          <button className="pill-dark" type="submit">
            Apply discount
          </button>
        </form>
      </article>

      <article className="row" style={{ marginTop: 16 }}>
        <div className="setup-head">
          <span>Refund</span>
        </div>
        <p className="empty">
          {invoice
            ? `Latest paid invoice ${invoice.id} · ${moneyAud(invoice.amountPaidCents)} on ${new Date(
                invoice.created * 1000,
              ).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}.`
            : 'No paid Stripe invoice on file.'}{' '}
          First-week refunds: refund + keep access (complimentary).
        </p>
        <form action={operatorRefundAction} style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
          <input type="hidden" name="userId" value={ownerUserId} />
          <label className="empty">
            Amount AUD (blank = full invoice)
            <input
              name="amount_aud"
              inputMode="decimal"
              placeholder={invoice ? String(invoice.amountPaidCents / 100) : ''}
              style={{ display: 'block', marginTop: 4, padding: '8px 10px', width: '100%' }}
            />
          </label>
          <label className="empty">
            <input type="checkbox" name="keep_access" value="1" defaultChecked /> Keep access
            (complimentary)
          </label>
          <label className="empty">
            <input type="checkbox" name="cancel_subscription" value="1" /> Cancel Stripe
            subscription
          </label>
          <label className="empty">
            <input type="checkbox" name="confirm" value="refund" required /> I confirm this refunds
            money in Stripe
          </label>
          <button className="pill-dark" type="submit" disabled={!invoice} style={{ justifySelf: 'start' }}>
            Refund
          </button>
        </form>
      </article>
    </div>
  );
}
