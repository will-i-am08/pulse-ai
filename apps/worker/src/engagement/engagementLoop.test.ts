import { describe, it, expect, vi } from "vitest";
import type { Brand, Interaction, InteractionStatus } from "@pulse/shared";
import type { EngagementResult } from "@pulse/gateway";
import {
  buildSpikeAlert,
  routeEngagementResult,
} from "./engagementLoop.js";
import type { RouteDeps } from "./engagementLoop.js";

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
    x_user_id: null,
    x_username: null,
    x_tokens_encrypted: null,
    meta_connected_at: null,
    facts: {},
    visual: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function fakeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: "interaction-1",
    brand_id: "brand-1",
    platform: "instagram",
    kind: "comment",
    external_id: "comment-123",
    author: "someone",
    text: "love this!",
    sentiment: "positive",
    bucket: "general",
    status: "new",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<RouteDeps> = {}) {
  const sendToBrand = vi.fn().mockResolvedValue(undefined);
  const graph = {
    publish: vi.fn(),
    fetchEngagement: vi.fn(),
    last24hCount: vi.fn(),
    reply: vi.fn().mockResolvedValue({ externalReplyId: "reply-1" }),
    hide: vi.fn().mockResolvedValue(undefined),
  };
  const deps: RouteDeps = { graph, sendToBrand, ...overrides };
  return { deps, sendToBrand, graph };
}

async function route(
  status: InteractionStatus,
  res: EngagementResult,
  it: Interaction = fakeInteraction(),
  overrides?: Partial<RouteDeps>,
) {
  const f = fakeDeps(overrides);
  await routeEngagementResult(fakeBrand(), it, status, res, f.deps);
  return f;
}

describe("routeEngagementResult", () => {
  it("posts auto-replies back without bothering the owner", async () => {
    const d = await route("auto_replied", {
      interaction: fakeInteraction(),
      publicReply: "Thanks so much!",
    });
    expect(d.graph.reply).toHaveBeenCalledOnce();
    expect(d.graph.reply).toHaveBeenCalledWith({
      brand: expect.objectContaining({ id: "brand-1" }),
      interaction: expect.objectContaining({ id: "interaction-1" }),
      body: "Thanks so much!",
    });
    expect(d.sendToBrand).not.toHaveBeenCalled();
  });

  it("delivers drafts to the owner and posts nothing", async () => {
    const d = await route("drafted", {
      interaction: fakeInteraction(),
      ownerMessage: 'Suggested reply:\n"How about this?"',
    });
    expect(d.sendToBrand).toHaveBeenCalledOnce();
    expect(d.sendToBrand).toHaveBeenCalledWith("brand-1", expect.stringContaining("Suggested reply"));
    expect(d.graph.reply).not.toHaveBeenCalled();
  });

  it("hides spam silently via the adapter", async () => {
    const d = await route("hidden", { interaction: fakeInteraction() });
    expect(d.graph.hide).toHaveBeenCalledOnce();
    expect(d.sendToBrand).not.toHaveBeenCalled();
  });

  it("surfaces a failed platform reply in the owner thread with the intended text", async () => {
    const f = await route(
      "auto_replied",
      { interaction: fakeInteraction(), publicReply: "Thanks so much!" },
      fakeInteraction(),
      {
        graph: {
          publish: vi.fn(),
          fetchEngagement: vi.fn(),
          last24hCount: vi.fn(),
          reply: vi.fn().mockRejectedValue(new Error("permission denied")),
        },
      },
    );
    expect(f.sendToBrand).toHaveBeenCalledOnce();
    const body = f.sendToBrand.mock.calls[0]?.[1] as string;
    expect(body).toContain("posting failed");
    expect(body).toContain("Thanks so much!");
  });
});

describe("buildSpikeAlert", () => {
  it("names the brand and the count", () => {
    const alert = buildSpikeAlert("Test Brand", 5);
    expect(alert).toContain("Test Brand");
    expect(alert).toContain("5 negative");
  });
});
