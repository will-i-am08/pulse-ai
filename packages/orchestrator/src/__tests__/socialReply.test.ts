import { describe, it, expect } from "vitest";
import type { Brand } from "@pulse/shared";
import { looksLikeGreeting } from "../classify.js";
import { quickReengageReply, quickSocialReply } from "../socialReply.js";

function brand(owner?: string): Brand {
  return {
    id: "brand-hi",
    name: "Cafe",
    facts: owner ? { owner_name: owner } : {},
  } as Brand;
}

describe("looksLikeGreeting", () => {
  it("matches whole-message hi / thanks / how's-it-going", () => {
    for (const t of ["hi", "Hey!", "hello", "thanks", "thanks so much", "how's it going"]) {
      expect(looksLikeGreeting(t), t).toBe(true);
    }
  });

  it("does not swallow an ask that starts with hey", () => {
    expect(looksLikeGreeting("hey can you post this")).toBe(false);
    expect(looksLikeGreeting("thanks for the carousel")).toBe(false);
    expect(looksLikeGreeting("draft me 3 posts")).toBe(false);
  });
});

describe("quickSocialReply", () => {
  it("returns a local hi without needing an LLM", () => {
    expect(quickSocialReply(brand("Bill"), "hi")).toMatch(/^(Hey|Hi) Bill[!./]/);
    expect(quickSocialReply(brand(), "Hey!")).toMatch(/^Hey/);
  });

  it("thanks and affirmations stay local", () => {
    expect(quickSocialReply(brand("Bill"), "thanks")).toMatch(/Anytime|No worries/);
    expect(quickSocialReply(brand("Bill"), "Awesome")).toMatch(/Nice one|Love that|Legend/);
  });

  it("does not claim a real ask", () => {
    expect(quickSocialReply(brand(), "hey can you post this")).toBeNull();
    expect(quickSocialReply(brand(), "draft me 3 posts")).toBeNull();
    expect(quickSocialReply(brand(), "thanks for the carousel")).toBeNull();
  });
});

describe("quickReengageReply", () => {
  it("weaves a human gap phrase, not 'it's been this morning'", () => {
    const sms = quickReengageReply(brand("Bill"), "hi", "this morning", null);
    expect(sms).toMatch(/Hey Bill, we last spoke this morning/);
    expect(sms).not.toMatch(/it's been this morning/);
  });

  it("keeps 'it's been a while' as-is and names unfinished work", () => {
    const sms = quickReengageReply(brand("Bill"), "hey", "it's been a while", {
      kind: "draft",
      summary: "your BTS post",
    });
    expect(sms).toMatch(/it's been a while/);
    expect(sms).toMatch(/Still got your BTS post/);
  });

  it("returns null when the inbound is not a social beat", () => {
    expect(quickReengageReply(brand(), "draft me 3", "yesterday", null)).toBeNull();
  });
});
