import { describe, expect, it, vi, beforeEach } from "vitest";
import { MockMarketingAdapter } from "@pulse/graph";
import {
  looksLikeAdsToggle,
  adsFeatureStatusLine,
  connectLinkMessage,
} from "../smsConnect.js";
import {
  adsEnabled,
  formatCents,
  brandFeatures,
  spendCaps,
} from "../adsFeatures.js";
import { looksLikeAdLibraryRequest } from "../adLibrary.js";
import { looksLikePastAdsRequest } from "../pastAds.js";
import { looksLikeBoostRequest } from "../boost.js";
import {
  looksLikePaidCampaignRequest,
  looksLikeAdCampaignControl,
} from "../adCampaigns.js";
import {
  looksLikeCapRaise,
  parseDollarCap,
  looksLikePauseConfirm,
  looksLikeScaleConfirm,
} from "../adSpend.js";
import type { Brand } from "@pulse/shared";

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "00000000-0000-0000-0000-0000000000f1",
    name: "Phase F Cafe",
    features: { ads: false },
    ads_spend_caps: { weekly_cents: 50_000, campaign_cents: 20_000 },
    ad_account_id: null,
    ad_account_name: null,
    ads_tokens_encrypted: null,
    ads_connected_at: null,
    icp: { segments: ["busy cafe owners"] },
    offers: { primary: "Free tasting flight", cta: "Book now", claim_constraints: ["no invented discounts"] },
    ...over,
  } as Brand;
}

describe("F1 ads feature flag + connect SMS", () => {
  it("detects enable/disable toggles", () => {
    expect(looksLikeAdsToggle("enable ads")).toBe("enable");
    expect(looksLikeAdsToggle("turn on ads please")).toBe("enable");
    expect(looksLikeAdsToggle("disable ads")).toBe("disable");
    expect(looksLikeAdsToggle("boost this")).toBeNull();
  });

  it("adsEnabled defaults off", () => {
    expect(adsEnabled(fakeBrand())).toBe(false);
    expect(adsEnabled(fakeBrand({ features: { ads: true } }))).toBe(true);
  });

  it("connect link for ads is a real deep link (not coming-soon stub)", async () => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.AUTH_SECRET = "test-auth-secret";
    const { resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();
    const { connectLinkMessage: link } = await import("../smsConnect.js");
    const msg = link(fakeBrand(), "ads");
    expect(msg).toMatch(/\/c\//);
    expect(msg).not.toMatch(/isn't live yet/i);
    expect(msg).toMatch(/ad account/i);
  });

  it("status line reflects connected + flag", () => {
    const line = adsFeatureStatusLine(
      fakeBrand({
        features: { ads: true },
        ad_account_id: "act_1",
        ads_tokens_encrypted: "x",
      }),
    );
    expect(line).toMatch(/on and your ad account is connected/i);
  });
});

describe("F2 Ad Library + past ads intents", () => {
  it("detects Ad Library requests", () => {
    expect(looksLikeAdLibraryRequest("do an ad library scan")).toBe(true);
    expect(looksLikeAdLibraryRequest("what ads are competitors running")).toBe(true);
    expect(looksLikeAdLibraryRequest("post this photo")).toBe(false);
  });

  it("detects past-ads requests", () => {
    expect(looksLikePastAdsRequest("show my past ads")).toBe(true);
    expect(looksLikePastAdsRequest("which ads worked")).toBe(true);
    expect(looksLikePastAdsRequest("hello")).toBe(false);
  });
});

describe("F3/F4 boost + campaign SMS verbs", () => {
  it("detects boost", () => {
    expect(looksLikeBoostRequest("boost this")).toBe(true);
    expect(looksLikeBoostRequest("promote that post")).toBe(true);
    expect(looksLikeBoostRequest("how did we do")).toBe(false);
  });

  it("detects paid campaign builder", () => {
    expect(looksLikePaidCampaignRequest("run ads for leads at $20/day")).toBe(true);
    expect(looksLikePaidCampaignRequest("create a paid campaign")).toBe(true);
    expect(looksLikePaidCampaignRequest("boost this")).toBe(false);
  });

  it("detects pause/resume/kill/budget controls", () => {
    expect(looksLikeAdCampaignControl("pause ads")).toBe("pause");
    expect(looksLikeAdCampaignControl("resume the boost")).toBe("resume");
    expect(looksLikeAdCampaignControl("kill the ads")).toBe("kill");
    expect(looksLikeAdCampaignControl("change ads budget to $30")).toBe("budget");
    expect(looksLikeAdCampaignControl("pause the campaign")).toBeNull(); // organic path
  });
});

describe("F5 spend caps helpers", () => {
  it("formats cents", () => {
    expect(formatCents(5000)).toBe("$50");
    expect(formatCents(2550)).toBe("$25.50");
  });

  it("parses cap raises", () => {
    expect(looksLikeCapRaise("raise weekly cap to $500")).toBe("weekly");
    expect(looksLikeCapRaise("raise campaign cap to $200")).toBe("campaign");
    expect(parseDollarCap("raise weekly cap to $500")).toBe(50_000);
  });

  it("detects pause/scale confirms", () => {
    expect(looksLikePauseConfirm("yes pause")).toBe(true);
    expect(looksLikeScaleConfirm("yes scale")).toBe(true);
  });

  it("reads default spend caps", () => {
    expect(spendCaps(fakeBrand()).weekly_cents).toBe(50_000);
    expect(brandFeatures(fakeBrand()).ads_autopilot).toBe(false);
  });
});

describe("F6 Mock Marketing adapter", () => {
  const adapter = new MockMarketingAdapter();

  it("lists mock ad accounts", async () => {
    const accounts = await adapter.listAdAccounts("tok");
    expect(accounts[0]?.id).toMatch(/^act_mock_/);
  });

  it("creates a campaign with real-shaped ids (no TODO)", async () => {
    const brand = fakeBrand({
      features: { ads: true },
      ad_account_id: "act_mock_1",
      ads_tokens_encrypted: "x",
      fb_page_id: "page_1",
    });
    const result = await adapter.createCampaign({
      brand,
      name: "Test leads",
      objective: "leads",
      dailyBudgetCents: 2000,
      audience: { label: "ICP", meta_type: "interest", interests: ["coffee"] },
      creative: { primary_text: "Try our flight", headline: "Taste", cta: "LEARN_MORE" },
      durationDays: 7,
    });
    expect(result.campaignId).toMatch(/^mock_camp_/);
    expect(result.adsetId).toBeTruthy();
    expect(result.adId).toBeTruthy();
    expect(result.status).toBe("ACTIVE");
  });

  it("boosts a post", async () => {
    const brand = fakeBrand({ features: { ads: true }, ad_account_id: "act_1", ads_tokens_encrypted: "x" });
    const result = await adapter.boostPost({
      brand,
      objectStoryId: "mock_story_1",
      name: "Boost",
      dailyBudgetCents: 1500,
      durationDays: 3,
      audience: { label: "engagers", meta_type: "retargeting" },
    });
    expect(result.campaignId).toMatch(/^mock_boost_/);
  });

  it("returns past ads + insights", async () => {
    const brand = fakeBrand({ features: { ads: true }, ad_account_id: "act_1", ads_tokens_encrypted: "x" });
    const past = await adapter.listPastAds(brand, 3);
    expect(past.length).toBeGreaterThan(0);
    const insights = await adapter.fetchCampaignInsights(brand, "mock_camp_abc");
    expect(insights.spendCents).toBeGreaterThan(0);
    expect(insights.impressions).toBeGreaterThan(0);
  });
});
