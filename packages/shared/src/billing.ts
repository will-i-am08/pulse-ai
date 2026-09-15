/**
 * Stripe price mapping, paid-access gating, and facts merge.
 *
 * Plan entitlements (Pro vs Max feature locks) stay in plan.ts and remain off
 * until PLAN_ENFORCEMENT=true. This module only answers: may this brand use
 * the product, and how do Stripe objects map onto brands.facts.
 */

import type {
  BrandPaymentFacts,
  BrandPaymentStatus,
  BrandPlanFacts,
  BusinessFacts,
} from "./types.js";
import { PLAN_PRICES_AUD, type PlanInterval, type PlanTier } from "./plan.js";

export type StripePriceCatalog = {
  pro_month: string;
  pro_year: string;
  max_month: string;
  max_year: string;
};

export type AccessOpts = { isAdmin?: boolean };

const PRICE_KEYS = ["pro_month", "pro_year", "max_month", "max_year"] as const;

/** Annual list totals (AUD, GST-inclusive) matching landing −20%. */
export const PLAN_YEAR_TOTAL_AUD = {
  pro: PLAN_PRICES_AUD.pro.year,
  max: PLAN_PRICES_AUD.max.year,
} as const;

export function stripePriceCatalogFromEnv(
  env: Record<string, string | undefined> = process.env,
): StripePriceCatalog | null {
  const catalog: StripePriceCatalog = {
    pro_month: (env.STRIPE_PRICE_PRO_MONTH ?? "").trim(),
    pro_year: (env.STRIPE_PRICE_PRO_YEAR ?? "").trim(),
    max_month: (env.STRIPE_PRICE_MAX_MONTH ?? "").trim(),
    max_year: (env.STRIPE_PRICE_MAX_YEAR ?? "").trim(),
  };
  if (PRICE_KEYS.some((k) => !catalog[k])) return null;
  return catalog;
}

export function stripePriceIdForPlan(
  plan: Pick<BrandPlanFacts, "tier" | "interval">,
  catalog: StripePriceCatalog,
): string {
  const interval = plan.interval === "year" ? "year" : "month";
  return catalog[`${plan.tier}_${interval}`];
}

export function planFromStripePriceId(
  priceId: string,
  catalog: StripePriceCatalog,
  selectedAt = new Date().toISOString(),
): BrandPlanFacts | null {
  const id = priceId.trim();
  if (!id) return null;
  let tier: PlanTier | null = null;
  let interval: PlanInterval | null = null;
  if (id === catalog.pro_month) {
    tier = "pro";
    interval = "month";
  } else if (id === catalog.pro_year) {
    tier = "pro";
    interval = "year";
  } else if (id === catalog.max_month) {
    tier = "max";
    interval = "month";
  } else if (id === catalog.max_year) {
    tier = "max";
    interval = "year";
  }
  if (!tier || !interval) return null;
  return { tier, interval, selected_at: selectedAt };
}

export function stripeSubscriptionToPaymentStatus(status: string): BrandPaymentStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
      return "incomplete";
    default:
      return "incomplete";
  }
}

/** Pre-Stripe demo submit: paid-looking in facts, never created a Stripe customer. */
export function isGrandfatheredUnpaid(facts: BusinessFacts | null | undefined): boolean {
  const payment = facts?.payment;
  if (!payment) return false;
  if (payment.stripe_customer_id) return false;
  return Boolean(payment.submitted_at);
}

/**
 * Whether the owner may use the product (dashboard + SMS onboarding).
 * past_due stays allowed while Stripe retries. unpaid/canceled lock unless
 * complimentary or grandfathered. Lab brands and admins always pass.
 */
export function hasPaidAccess(facts: BusinessFacts | null | undefined, opts?: AccessOpts): boolean {
  if (opts?.isAdmin) return true;
  if (facts?.lab) return true;
  const payment = facts?.payment;
  if (payment?.complimentary) return true;
  const status = payment?.status;
  if (status === "active" || status === "past_due") return true;
  if (isGrandfatheredUnpaid(facts)) return true;
  return false;
}

export function canAccessBillingPortal(
  facts: BusinessFacts | null | undefined,
  opts?: AccessOpts,
): boolean {
  if (hasPaidAccess(facts, opts)) return true;
  return Boolean(facts?.payment?.stripe_customer_id);
}

export function canAccessAppPath(
  pathname: string,
  facts: BusinessFacts | null | undefined,
  opts?: AccessOpts,
): boolean {
  if (hasPaidAccess(facts, opts)) return true;
  const billing = pathname === "/app/billing" || pathname.startsWith("/app/billing/");
  if (billing) return canAccessBillingPortal(facts, opts);
  return false;
}

export function shouldKickOffOnboarding(status: string | undefined | null): boolean {
  const s = status ?? "none";
  return s === "none" || s === "pending";
}

/** Count estimated MRR — complimentary and unpaid/canceled do not. */
export function countsTowardMrr(facts: BusinessFacts | null | undefined): boolean {
  if (facts?.lab) return false;
  if (facts?.payment?.complimentary) return false;
  const status = facts?.payment?.status;
  if (status === "active" || status === "past_due") return true;
  if (isGrandfatheredUnpaid(facts)) return true;
  if (status === "submitted" && !facts?.payment?.stripe_customer_id) return true;
  return false;
}

export type SubscriptionFactsInput = {
  status: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  priceId?: string | null;
  /** Unix seconds. */
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean | null;
  catalog: StripePriceCatalog;
};

export function mergeSubscriptionIntoFacts(
  facts: BusinessFacts,
  input: SubscriptionFactsInput,
): BusinessFacts {
  const paymentStatus = stripeSubscriptionToPaymentStatus(input.status);
  const plan = input.priceId ? planFromStripePriceId(input.priceId, input.catalog) : null;
  const prev: BrandPaymentFacts = { ...(facts.payment ?? {}) };
  const paidNow = paymentStatus === "active" || paymentStatus === "past_due";
  const nextPayment: BrandPaymentFacts = {
    ...prev,
    status: paymentStatus,
    submitted_at: prev.submitted_at ?? (paidNow ? new Date().toISOString() : prev.submitted_at),
    stripe_customer_id: input.customerId || prev.stripe_customer_id,
    stripe_subscription_id: input.subscriptionId || prev.stripe_subscription_id,
    stripe_price_id: input.priceId || prev.stripe_price_id,
    current_period_end: input.currentPeriodEnd
      ? new Date(input.currentPeriodEnd * 1000).toISOString()
      : prev.current_period_end,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? prev.cancel_at_period_end,
  };
  const next: BusinessFacts = { ...facts, payment: nextPayment };
  if (plan) next.plan = plan;
  return next;
}
