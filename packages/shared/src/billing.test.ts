import { describe, expect, it } from "vitest";
import {
  canAccessAppPath,
  canAccessBillingPortal,
  countsTowardMrr,
  hasPaidAccess,
  mergeSubscriptionIntoFacts,
  planFromLookupKey,
  planFromStripePrice,
  planFromStripePriceId,
  shouldKickOffOnboarding,
  stripePriceIdForPlan,
  stripeSubscriptionToPaymentStatus,
} from "./billing.js";
import type { BusinessFacts } from "./types.js";

const catalog = {
  pro_month: "price_pro_m",
  pro_year: "price_pro_y",
  max_month: "price_max_m",
  max_year: "price_max_y",
};

describe("stripe price mapping", () => {
  it("maps plan → price id and back", () => {
    const plan = { tier: "max" as const, interval: "year" as const };
    const id = stripePriceIdForPlan(plan, catalog);
    expect(id).toBe("price_max_y");
    expect(planFromStripePriceId(id, catalog)?.tier).toBe("max");
    expect(planFromStripePriceId(id, catalog)?.interval).toBe("year");
  });

  it("returns null for unknown price ids", () => {
    expect(planFromStripePriceId("price_other", catalog)).toBeNull();
  });

  it("maps lookup keys and price metadata without env catalog ids", () => {
    expect(planFromLookupKey("kip_max_year")?.tier).toBe("max");
    expect(planFromLookupKey("kip_max_year")?.interval).toBe("year");
    expect(planFromStripePrice({ lookup_key: "kip_pro_month" })?.tier).toBe("pro");
    expect(
      planFromStripePrice({ metadata: { tier: "max", interval: "month" } })?.interval,
    ).toBe("month");
    expect(planFromStripePrice({ id: "price_unknown" })).toBeNull();
  });
});

describe("hasPaidAccess", () => {
  it("allows active and past_due", () => {
    expect(hasPaidAccess({ payment: { status: "active" } })).toBe(true);
    expect(hasPaidAccess({ payment: { status: "past_due" } })).toBe(true);
  });

  it("locks unpaid and canceled unless complimentary", () => {
    expect(hasPaidAccess({ payment: { status: "canceled", stripe_customer_id: "cus_1" } })).toBe(
      false,
    );
    expect(hasPaidAccess({ payment: { status: "unpaid", stripe_customer_id: "cus_1" } })).toBe(
      false,
    );
    expect(
      hasPaidAccess({
        payment: { status: "canceled", stripe_customer_id: "cus_1", complimentary: true },
      }),
    ).toBe(true);
  });

  it("grandfathers pre-Stripe submitted_at without a customer", () => {
    expect(hasPaidAccess({ payment: { submitted_at: "2026-01-01T00:00:00.000Z" } })).toBe(true);
    expect(
      hasPaidAccess({
        payment: { submitted_at: "2026-01-01T00:00:00.000Z", stripe_customer_id: "cus_1" },
      }),
    ).toBe(false);
  });

  it("allows lab brands and admins", () => {
    expect(hasPaidAccess({ lab: true })).toBe(true);
    expect(hasPaidAccess({ payment: { status: "none" } }, { isAdmin: true })).toBe(true);
  });

  it("denies unpaid new signups", () => {
    expect(hasPaidAccess({})).toBe(false);
    expect(hasPaidAccess({ payment: { status: "incomplete" } })).toBe(false);
  });
});

describe("app path gating", () => {
  const canceled: BusinessFacts = {
    payment: { status: "canceled", stripe_customer_id: "cus_1" },
  };

  it("lets canceled customers open billing only", () => {
    expect(canAccessBillingPortal(canceled)).toBe(true);
    expect(canAccessAppPath("/app/billing", canceled)).toBe(true);
    expect(canAccessAppPath("/app", canceled)).toBe(false);
    expect(canAccessAppPath("/app/plan", canceled)).toBe(false);
  });
});

describe("onboarding kickoff", () => {
  it("kicks off only from none/pending", () => {
    expect(shouldKickOffOnboarding("none")).toBe(true);
    expect(shouldKickOffOnboarding("pending")).toBe(true);
    expect(shouldKickOffOnboarding(undefined)).toBe(true);
    expect(shouldKickOffOnboarding("awaiting_contact")).toBe(false);
    expect(shouldKickOffOnboarding("done")).toBe(false);
  });
});

describe("mergeSubscriptionIntoFacts", () => {
  it("sets active status, stripe ids, and plan from price", () => {
    const next = mergeSubscriptionIntoFacts(
      { plan_preference: { tier: "pro", interval: "month" } },
      {
        status: "active",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        priceId: "price_max_m",
        currentPeriodEnd: 1_800_000_000,
        cancelAtPeriodEnd: false,
        catalog,
      },
    );
    expect(next.plan?.tier).toBe("max");
    expect(next.payment?.status).toBe("active");
    expect(next.payment?.stripe_customer_id).toBe("cus_1");
    expect(next.payment?.stripe_subscription_id).toBe("sub_1");
    expect(next.payment?.submitted_at).toBeTruthy();
  });

  it("is idempotent on submitted_at when applied twice", () => {
    const first = mergeSubscriptionIntoFacts(
      {},
      {
        status: "active",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        priceId: "price_pro_m",
        catalog,
      },
    );
    const submitted = first.payment?.submitted_at;
    const second = mergeSubscriptionIntoFacts(first, {
      status: "active",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      priceId: "price_pro_m",
      catalog,
    });
    expect(second.payment?.submitted_at).toBe(submitted);
  });

  it("maps plan from lookup key when catalog ids are absent", () => {
    const next = mergeSubscriptionIntoFacts(
      {},
      {
        status: "active",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        priceId: "price_live_unknown",
        lookupKey: "kip_pro_month",
      },
    );
    expect(next.plan?.tier).toBe("pro");
    expect(next.plan?.interval).toBe("month");
    expect(next.payment?.status).toBe("active");
  });

  it("maps deleted subscription to canceled without dropping customer id", () => {
    const next = mergeSubscriptionIntoFacts(
      {
        payment: {
          status: "active",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
        },
      },
      { status: "canceled", customerId: "cus_1", subscriptionId: "sub_1", catalog },
    );
    expect(next.payment?.status).toBe("canceled");
    expect(next.payment?.stripe_customer_id).toBe("cus_1");
  });

  it("maps subscription statuses", () => {
    expect(stripeSubscriptionToPaymentStatus("trialing")).toBe("active");
    expect(stripeSubscriptionToPaymentStatus("past_due")).toBe("past_due");
    expect(stripeSubscriptionToPaymentStatus("unpaid")).toBe("unpaid");
    expect(stripeSubscriptionToPaymentStatus("paused")).toBe("unpaid");
  });
});

describe("MRR inclusion", () => {
  it("excludes complimentary and canceled", () => {
    expect(countsTowardMrr({ payment: { status: "active" } })).toBe(true);
    expect(countsTowardMrr({ payment: { status: "past_due" } })).toBe(true);
    expect(countsTowardMrr({ payment: { status: "active", complimentary: true } })).toBe(false);
    expect(countsTowardMrr({ payment: { status: "canceled", stripe_customer_id: "cus_1" } })).toBe(
      false,
    );
    expect(countsTowardMrr({ payment: { submitted_at: "2026-01-01T00:00:00.000Z" } })).toBe(true);
  });
});
