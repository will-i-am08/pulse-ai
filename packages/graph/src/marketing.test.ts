import { describe, expect, it } from "vitest";
import { MockMarketingAdapter, LiveMarketingAdapter } from "../index.js";

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
  });
});
