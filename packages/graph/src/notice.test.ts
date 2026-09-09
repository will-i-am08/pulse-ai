import { describe, it, expect, vi, afterEach } from "vitest";
import type { Brand } from "@pulse/shared";
import { MockGraphAdapter } from "./mock.js";
import { LiveGraphAdapter } from "./live.js";
import { didPublishLive, publishConfirmation } from "./notice.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeBrand(): Brand {
  return {
    id: "brand-1",
    name: "Test Brand",
    client_phone: "+61400000000",
    discord_channel_id: null,
    discord_user_id: null,
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" },
    brand_voice_profile: {
      tone: [],
      dos: [],
      donts: [],
      example_captions: [],
      banned_words: [],
      emoji_policy: "sparing",
      hashtag_policy: "",
      notes: [],
    },
    ig_user_id: null,
    fb_page_id: null,
    fb_page_name: null,
    ig_username: null,
    platform_tokens_encrypted: null,
    platform_user_token_encrypted: null,
    meta_connected_at: null,
    facts: {},
    visual: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

  it("LiveGraphAdapter still mocks Threads", async () => {
    const fetchSpy = stubFetch();
    const res = await new LiveGraphAdapter().publish({
      brand: fakeBrand(),
      platform: "threads",
      caption: "still mock",
      mediaUrls: ["https://example.test/photo.jpg"],
    });
    expect(res.externalPostId.startsWith("mock_")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("publish notice", () => {
  it("X and Threads never count as live", () => {
    expect(didPublishLive("x", "live")).toBe(false);
    expect(didPublishLive("threads", "live")).toBe(false);
    expect(didPublishLive("instagram", "live")).toBe(true);
    expect(didPublishLive("facebook", "mock")).toBe(false);
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
});
