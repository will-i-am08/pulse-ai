import { describe, it, expect, vi, afterEach } from "vitest";
import type { Brand } from "@pulse/shared";
import { emptyBrandVoiceProfile } from "@pulse/shared";
import { MockGraphAdapter } from "./mock.js";
import { LiveGraphAdapter } from "./live.js";
import { didPublishLive, publishConfirmation } from "./notice.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Test Brand",
    client_phone: "+61400000000",
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" },
    contact_card_sent_at: null,
    brand_voice_profile: emptyBrandVoiceProfile(),
    ig_user_id: null,
    fb_page_id: null,
    fb_page_name: null,
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
    features: {},
    ad_account_id: null,
    ad_account_name: null,
    ads_tokens_encrypted: null,
    ads_connected_at: null,
    ads_spend_caps: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function stubFetch() {
  const spy = vi.fn(async () => {
    throw new Error("network should not be called for mock X/Threads");
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("mock X and Threads publish", () => {
  it("publishes X to the fake graph without tokens or network", async () => {
    const fetchSpy = stubFetch();
    const res = await new MockGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "x",
      caption: "hello from pulse",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    expect(res.externalPostId.startsWith("mock_")).toBe(true);
    expect(res.permalink).toContain("/x/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishes Threads to the fake graph without tokens or network", async () => {
    const fetchSpy = stubFetch();
    const res = await new MockGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "threads",
      caption: "hello longer thread",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    expect(res.externalPostId.startsWith("mock_")).toBe(true);
    expect(res.permalink).toContain("/threads/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishes LinkedIn and TikTok to the fake graph without network", async () => {
    const fetchSpy = stubFetch();
    const li = await new MockGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "linkedin",
      caption: "company update",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    const tt = await new MockGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "tiktok",
      caption: "short clip",
      mediaUrls: ["https://example.test/clip.mp4"],
    });
    expect(li.externalPostId.startsWith("mock_")).toBe(true);
    expect(li.permalink).toContain("/linkedin/");
    expect(tt.externalPostId.startsWith("mock_")).toBe(true);
    expect(tt.permalink).toContain("/tiktok/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("LiveGraphAdapter still mocks X — no tokens, no API key, not a live post", async () => {
    const fetchSpy = stubFetch();
    const res = await new LiveGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "x",
      caption: "still mock",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    expect(res.externalPostId.startsWith("mock_")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("LiveGraphAdapter mocks Threads when the brand has no connected token", async () => {
    const fetchSpy = stubFetch();
    const res = await new LiveGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "threads",
      caption: "no token yet",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    expect(res.externalPostId.startsWith("mock_")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("LiveGraphAdapter mocks LinkedIn/TikTok when app creds missing", async () => {
    const fetchSpy = stubFetch();
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.TIKTOK_CLIENT_KEY;
    const li = await new LiveGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "linkedin",
      caption: "no li creds",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    const tt = await new LiveGraphAdapter().publish({
      brand: fakeBrand({
        tiktok_tokens_encrypted: "enc",
        tiktok_open_id: "oid",
      }),
      platform: "tiktok",
      caption: "no client key",
      mediaUrls: ["https://example.test/clip.mp4"],
    });
    expect(li.externalPostId.startsWith("mock_")).toBe(true);
    expect(tt.externalPostId.startsWith("mock_")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("publish notice", () => {
  it("X never counts as live; Threads/LinkedIn/TikTok can once live", () => {
    const prev = process.env.TIKTOK_AUDIT_PASSED;
    delete process.env.TIKTOK_AUDIT_PASSED;
    expect(didPublishLive("x", "live")).toBe(false);
    expect(didPublishLive("threads", "live")).toBe(true);
    expect(didPublishLive("linkedin", "live")).toBe(true);
    // Unaudited TikTok may still live-post privately (SELF_ONLY) — not mock-only.
    expect(didPublishLive("tiktok", "live")).toBe(true);
    expect(didPublishLive("instagram", "live")).toBe(true);
    expect(didPublishLive("facebook", "mock")).toBe(false);
    if (prev === undefined) delete process.env.TIKTOK_AUDIT_PASSED;
    else process.env.TIKTOK_AUDIT_PASSED = prev;
  });

  it("names X and that it did not go live", () => {
    const msg = publishConfirmation("x", {
      live: false,
      feedUrl: "https://app.example/feed?platform=x",
    });
    expect(msg).toMatch(/\bX\b/);
    expect(msg).toMatch(/did not go live/i);
    expect(msg.toLowerCase()).not.toMatch(/api key/);
  });

  it("includes permalink when live LinkedIn confirms", () => {
    const msg = publishConfirmation("linkedin", {
      live: true,
      feedUrl: "https://app.example/feed?platform=linkedin",
      externalPostId: "urn:li:share:1",
      permalink: "https://www.linkedin.com/feed/update/urn:li:share:1",
    });
    expect(msg).toMatch(/LinkedIn/);
    expect(msg).toMatch(/linkedin\.com/);
  });
});
