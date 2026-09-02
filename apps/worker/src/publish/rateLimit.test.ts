import { describe, it, expect, vi } from "vitest";
import type { GraphAdapter } from "@pulse/graph";
import type { Brand } from "@pulse/shared";
import { checkRateLimit } from "./rateLimit.js";

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
    onboarding_state: { status: "none" as const },
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
    ig_user_id: "ig-1",
    fb_page_id: "fb-1",
    platform_tokens_encrypted: null,
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Only last24hCount matters for this gate — the other two members are unused here.
function fakeAdapter(count: number): GraphAdapter {
  return {
    publish: vi.fn(),
    fetchEngagement: vi.fn(),
    last24hCount: vi.fn().mockResolvedValue(count),
  };
}

describe("checkRateLimit", () => {
  it("blocks Instagram publishing once the 100/24h ceiling is reached", async () => {
    const result = await checkRateLimit(fakeAdapter(100), fakeBrand(), "instagram");
    expect(result.ok).toBe(false);
    expect(result.limit).toBe(100);
    expect(result.count).toBe(100);
  });

  it("blocks Instagram publishing above the ceiling too", async () => {
    const result = await checkRateLimit(fakeAdapter(150), fakeBrand(), "instagram");
    expect(result.ok).toBe(false);
  });

  it("allows Instagram publishing under the ceiling", async () => {
    const result = await checkRateLimit(fakeAdapter(42), fakeBrand(), "instagram");
    expect(result.ok).toBe(true);
  });

  it("blocks Facebook publishing once the 25/Page/24h ceiling is reached", async () => {
    const result = await checkRateLimit(fakeAdapter(25), fakeBrand(), "facebook");
    expect(result.ok).toBe(false);
    expect(result.limit).toBe(25);
  });

  it("allows Facebook publishing under the ceiling", async () => {
    const result = await checkRateLimit(fakeAdapter(3), fakeBrand(), "facebook");
    expect(result.ok).toBe(true);
  });

  it("calls last24hCount with the brand and platform", async () => {
    const adapter = fakeAdapter(0);
    const brand = fakeBrand();
    await checkRateLimit(adapter, brand, "facebook");
    expect(adapter.last24hCount).toHaveBeenCalledWith(brand, "facebook");
  });
});
