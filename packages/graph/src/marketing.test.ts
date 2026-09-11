import { describe, expect, it, vi, afterEach } from "vitest";
import { MockMarketingAdapter } from "./marketingMock.js";
import { LiveMarketingAdapter } from "./marketingLive.js";
import { emptyBrandVoiceProfile, type Brand } from "@pulse/shared";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function brandWithAds(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-ads",
    name: "Ads Co",
    client_phone: "+61400000001",
    owner_user_id: null,
    account_type: null,
    website: "https://example.com",
    onboarding_state: { status: "none" },
    contact_card_sent_at: null,
    brand_voice_profile: emptyBrandVoiceProfile(),
    ig_user_id: null,
    fb_page_id: "page_1",
    fb_page_name: "Page",
    ig_username: null,
    platform_tokens_encrypted: null,
    platform_user_token_encrypted: null,
    x_user_id: null,
    x_username: null,
    x_tokens_encrypted: null,
    threads_user_id: null,
    threads_username: null,
    threads_tokens_encrypted: null,
    linkedin_org_id: null,
    linkedin_org_name: null,
    linkedin_tokens_encrypted: null,
    linkedin_connected_at: null,
    tiktok_open_id: null,
    tiktok_display_name: null,
    tiktok_tokens_encrypted: null,
    tiktok_connected_at: null,
    tiktok_privacy_defaults: null,
    meta_connected_at: null,
    voice_guide_md: null,
    voice_analysis_state: { status: "none" },
    facts: {},
    visual: {},
    icp: {},
    pain_points: {},
    positioning: {},
    offers: {},
    features: { ads: true },
    ad_account_id: "act_123",
    ad_account_name: "Test Ads",
    ads_tokens_encrypted: null,
    ads_connected_at: new Date().toISOString(),
    ads_spend_caps: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("Marketing adapters (Phase F6)", () => {
  it("MockMarketingAdapter implements happy path without network", async () => {
    const m = new MockMarketingAdapter();
    const accounts = await m.listAdAccounts("token");
    expect(accounts.length).toBe(1);
    await m.pauseCampaign({ id: "b" } as any, "camp_1");
    await m.resumeCampaign({ id: "b" } as any, "camp_1");
    await m.killCampaign({ id: "b" } as any, "camp_1");
    await m.updateBudget({ id: "b" } as any, "adset_1", 2500);
  });

  it("LiveMarketingAdapter is constructible (happy-path methods exist, not stubs)", () => {
    const live = new LiveMarketingAdapter();
    expect(typeof live.createCampaign).toBe("function");
    expect(typeof live.boostPost).toBe("function");
    expect(typeof live.listPastAds).toBe("function");
    expect(typeof live.fetchCampaignInsights).toBe("function");
    expect(typeof live.listAdAccounts).toBe("function");
    // Source must not leave TODO stubs on the happy path.
    expect(LiveMarketingAdapter.toString()).not.toMatch(/TODO/);
  });

  it("LiveMarketingAdapter.createCampaign requires ad_account_id (choose-ads persistence)", async () => {
    process.env.META_GRAPH_VERSION = "v21.0";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");
    const { encryptJson, resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();

    const live = new LiveMarketingAdapter();
    const brand = brandWithAds({
      ad_account_id: null,
      ads_tokens_encrypted: encryptJson({ access_token: "EAAG", ad_account_id: "act_123" }),
    });
    await expect(
      live.createCampaign({
        brand,
        name: "Test",
        objective: "traffic",
        dailyBudgetCents: 1000,
        audience: { geo: "US" },
        creative: { primary_text: "hi" },
        durationDays: 3,
      }),
    ).rejects.toThrow(/ad_account_id/);
  });

  it("LiveMarketingAdapter.fetchCampaignInsights pulls spend when Meta responds", async () => {
    process.env.META_GRAPH_VERSION = "v21.0";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");

    const { encryptJson, resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [{ spend: "12.50", impressions: "100", clicks: "5", ctr: "5", actions: [] }],
        }),
      } as any;
    }) as any;

    const live = new LiveMarketingAdapter();
    const brand = brandWithAds({
      ads_tokens_encrypted: encryptJson({ access_token: "EAAG", ad_account_id: "act_123" }),
    });
    const insights = await live.fetchCampaignInsights(brand, "camp_99");
    expect(insights.spendCents).toBe(1250);
    expect(insights.impressions).toBe(100);
    expect((globalThis.fetch as any).mock.calls[0][0]).toMatch(/insights/);
  });
});
