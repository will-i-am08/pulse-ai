/**
 * Plan catalog + entitlement scaffolding.
 *
 * Marketing / signup already collect Pro vs Max preference on the brand
 * (`facts.plan` / `facts.plan_preference`). Until Stripe is live, **nothing
 * here enforces paywalls, feature locks, or per-plan usage caps**.
 *
 * Call sites that will eventually gate should use {@link entitlementsFor}
 * (or the helpers below) so flipping enforcement is one place — not scattered
 * `if (tier === "pro")` checks. Today every brand gets the full Max envelope.
 *
 * Enable later with: Stripe wired + env `PLAN_ENFORCEMENT=true`.
 */

import type { Brand, BrandPlanFacts, BusinessFacts } from "./types.js";

export type PlanTier = BrandPlanFacts["tier"];
export type PlanInterval = BrandPlanFacts["interval"];

/** List prices shown on the landing page (AUD, GST-inclusive). */
export const PLAN_PRICES_AUD = {
  pro: { month: 79, yearMonthlyEquivalent: 63, year: 756 },
  max: { month: 149, yearMonthlyEquivalent: 119, year: 1428 },
} as const;

/**
 * Intended ceilings once Stripe turns enforcement on.
 * Numbers match docs/PRICING.md — unused for gating while enforcement is off.
 */
export type PlanEntitlements = {
  tier: PlanTier | "open";
  /** When false, ignore numeric ceilings and feature flags below. */
  enforcement: boolean;
  autopilotDefault: boolean;
  adsUnlockable: boolean;
  competitorWatchesMax: number;
  /** Soft UGC / AI-video budget (USD / calendar month). */
  ugcBudgetUsdMonth: number;
  /** Soft weekly AI spend (USD). */
  aiSpendUsdWeek: number;
  /** Soft image restyles / month. */
  imageRestylesMonth: number;
};

const INTENDED: Record<PlanTier, Omit<PlanEntitlements, "tier" | "enforcement">> = {
  pro: {
    autopilotDefault: false,
    adsUnlockable: false,
    competitorWatchesMax: 1,
    ugcBudgetUsdMonth: 6,
    aiSpendUsdWeek: 5,
    imageRestylesMonth: 40,
  },
  max: {
    autopilotDefault: true,
    adsUnlockable: true,
    competitorWatchesMax: 3,
    ugcBudgetUsdMonth: 20,
    aiSpendUsdWeek: 10,
    imageRestylesMonth: 100,
  },
};

/** Full product envelope — what every brand gets while plans are advisory only. */
const OPEN_ENTITLEMENTS: PlanEntitlements = {
  tier: "open",
  enforcement: false,
  ...INTENDED.max,
};

/**
 * True only when we intentionally turn plan gates on (post-Stripe).
 * Default off — missing/invalid env never locks anyone out.
 */
export function planEnforcementEnabled(): boolean {
  const flag = (process.env.PLAN_ENFORCEMENT ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return false;
  // Require a Stripe signal so a mistaken flag alone can't paywall users.
  if (!(process.env.STRIPE_SECRET_KEY ?? "").trim()) return false;
  return true;
}

/** Preference or confirmed plan on the brand, if any. */
export function resolveBrandPlan(
  facts: BusinessFacts | null | undefined,
): BrandPlanFacts | null {
  if (!facts) return null;
  return facts.plan ?? facts.plan_preference ?? null;
}

export function resolveBrandPlanFromBrand(brand: Pick<Brand, "facts">): BrandPlanFacts | null {
  return resolveBrandPlan(brand.facts ?? null);
}

/**
 * Entitlements for a brand. While enforcement is off, always returns the open
 * (Max-level) envelope regardless of stored Pro/Max preference.
 */
export function entitlementsFor(facts: BusinessFacts | null | undefined): PlanEntitlements {
  if (!planEnforcementEnabled()) return { ...OPEN_ENTITLEMENTS };

  const plan = resolveBrandPlan(facts);
  const tier: PlanTier = plan?.tier === "pro" || plan?.tier === "max" ? plan.tier : "max";
  return {
    tier,
    enforcement: true,
    ...INTENDED[tier],
  };
}

export function entitlementsForBrand(brand: Pick<Brand, "facts">): PlanEntitlements {
  return entitlementsFor(brand.facts ?? null);
}

/** Catalog row for docs / future Stripe Price mapping — not enforced. */
export function intendedEntitlements(tier: PlanTier): PlanEntitlements {
  return { tier, enforcement: false, ...INTENDED[tier] };
}
