import { describe, it, expect, vi } from "vitest";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { isWithinLast24h, runCheckin } from "./checkin.js";

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
    ig_user_id: null,
    fb_page_id: null,
    fb_page_name: null,
    ig_username: null,
    platform_tokens_encrypted: null,
    platform_user_token_encrypted: null,
    meta_connected_at: null,
    google_tokens_encrypted: null,
    gbp_account: null,
    gbp_location_id: null,
    gbp_location_name: null,
    google_connected_at: null,
    facts: {},
    visual: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function fakeTrigger(): ProactiveTrigger {
  return {
    id: "trigger-1",
    brand_id: "brand-1",
    kind: "checkin",
    schedule: "0 9 * * 1",
    template_id: null,
    enabled: true,
    last_sent_at: null,
    created_at: new Date().toISOString(),
  };
}

describe("isWithinLast24h", () => {
  it("is false for a null timestamp", () => {
    expect(isWithinLast24h(null)).toBe(false);
  });

  it("is true for a timestamp inside the last 24h", () => {
    const now = new Date("2026-01-08T12:00:00Z");
    expect(isWithinLast24h(new Date("2026-01-08T00:00:00Z").toISOString(), now)).toBe(true);
  });

  it("is false for a timestamp older than 24h", () => {
    const now = new Date("2026-01-08T12:00:00Z");
    expect(isWithinLast24h(new Date("2026-01-06T00:00:00Z").toISOString(), now)).toBe(false);
  });
});

describe("runCheckin", () => {
  // Daytime is injected, so tests are independent of the real clock/timezone.
  const daytime = () => true;
  const noActionable = vi.fn().mockResolvedValue(null);

  it("skips sending when the brand already messaged in the last 24h", async () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const sendToBrand = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const getLastInboundAt = vi.fn().mockResolvedValue(new Date("2026-01-08T02:00:00Z").toISOString());

    await runCheckin(fakeBrand(), fakeTrigger(), {
      getLastInboundAt,
      getActionable: noActionable,
      isDaytime: daytime,
      sendToBrand,
      markSent,
      now: () => now,
    });

    expect(sendToBrand).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("skips sending outside daytime hours (retries later, no markSent)", async () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const sendToBrand = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const getLastInboundAt = vi.fn().mockResolvedValue(null);

    await runCheckin(fakeBrand(), fakeTrigger(), {
      getLastInboundAt,
      getActionable: noActionable,
      isDaytime: () => false,
      sendToBrand,
      markSent,
      now: () => now,
    });

    expect(sendToBrand).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("sends the generic weekly nudge when nothing is pending", async () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const sendToBrand = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const getLastInboundAt = vi.fn().mockResolvedValue(new Date("2026-01-05T00:00:00Z").toISOString());

    await runCheckin(fakeBrand(), fakeTrigger(), {
      getLastInboundAt,
      getActionable: noActionable,
      isDaytime: daytime,
      sendToBrand,
      markSent,
      now: () => now,
    });

    expect(sendToBrand).toHaveBeenCalledWith("brand-1", "Anything to send me this week?");
    expect(markSent).toHaveBeenCalledWith("trigger-1");
  });

  it("names the unfinished thing when something's pending", async () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const sendToBrand = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const getLastInboundAt = vi.fn().mockResolvedValue(null);
    const getActionable = vi.fn().mockResolvedValue({ kind: "draft", summary: "your BTS post" });

    await runCheckin(fakeBrand(), fakeTrigger(), {
      getLastInboundAt,
      getActionable,
      isDaytime: daytime,
      sendToBrand,
      markSent,
      now: () => now,
    });

    expect(sendToBrand).toHaveBeenCalledTimes(1);
    expect(sendToBrand.mock.calls[0]![1]).toContain("your BTS post");
    expect(markSent).toHaveBeenCalledWith("trigger-1");
  });
});
