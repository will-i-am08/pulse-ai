import { afterEach, describe, expect, it } from "vitest";
import {
  entitlementsFor,
  intendedEntitlements,
  planEnforcementEnabled,
  resolveBrandPlan,
} from "./plan.js";

const prevEnforcement = process.env.PLAN_ENFORCEMENT;
const prevStripe = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  if (prevEnforcement === undefined) delete process.env.PLAN_ENFORCEMENT;
  else process.env.PLAN_ENFORCEMENT = prevEnforcement;
  if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevStripe;
});

describe("plan scaffolding (pre-Stripe)", () => {
  it("keeps enforcement off by default", () => {
    delete process.env.PLAN_ENFORCEMENT;
    delete process.env.STRIPE_SECRET_KEY;
    expect(planEnforcementEnabled()).toBe(false);
  });

  it("does not enforce with flag alone (no Stripe key)", () => {
    process.env.PLAN_ENFORCEMENT = "true";
    delete process.env.STRIPE_SECRET_KEY;
    expect(planEnforcementEnabled()).toBe(false);
  });

  it("returns open Max-level entitlements regardless of stored Pro preference", () => {
    delete process.env.PLAN_ENFORCEMENT;
    const e = entitlementsFor({
      plan: { tier: "pro", interval: "month" },
    });
    expect(e.enforcement).toBe(false);
    expect(e.tier).toBe("open");
    expect(e.ugcBudgetUsdMonth).toBe(intendedEntitlements("max").ugcBudgetUsdMonth);
    expect(e.adsUnlockable).toBe(true);
  });

  it("resolveBrandPlan prefers confirmed plan over preference", () => {
    expect(
      resolveBrandPlan({
        plan_preference: { tier: "pro", interval: "month" },
        plan: { tier: "max", interval: "year" },
      })?.tier,
    ).toBe("max");
  });
});
