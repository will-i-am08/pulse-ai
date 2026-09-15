import { describe, it, expect } from "vitest";
import {
  looksLikeProgressCheck,
  shouldSendInstantTextAck,
  shouldSendSlowWorkFiller,
  splitIntoBubbles,
} from "./gateway.js";

describe("looksLikeProgressCheck", () => {
  it("matches how's-it-going / status pings", () => {
    for (const t of [
      "How's it going?",
      "hows it going",
      "How is it going",
      "any update?",
      "what's the status",
      "progress?",
      "are you done?",
      "still working?",
    ]) {
      expect(looksLikeProgressCheck(t)).toBe(true);
    }
  });

  it("leaves real asks alone", () => {
    expect(looksLikeProgressCheck("can you make it shorter")).toBe(false);
    expect(looksLikeProgressCheck("draft me 3 posts")).toBe(false);
  });
});

describe("shouldSendInstantTextAck", () => {
  it("never sends thin one-liner text acks (Makes sense / Got you)", () => {
    const done = { onboarding_state: { status: "done" as const } };
    expect(shouldSendInstantTextAck(done, "can you make it shorter")).toBe(false);
    expect(shouldSendInstantTextAck(done, "Awesome")).toBe(false);
    expect(shouldSendInstantTextAck({ onboarding_state: { status: "none" } }, "hey")).toBe(false);
    expect(
      shouldSendInstantTextAck({ onboarding_state: { status: "in_progress" } }, "sounds good"),
    ).toBe(false);
  });
});

describe("shouldSendSlowWorkFiller", () => {
  const base = { photoAckSent: false, textAckSent: false, hasTyping: false };
  it("fires only for known-slow draft jobs on SMS", () => {
    expect(shouldSendSlowWorkFiller({ ...base, inboundText: "draft me 3 posts" })).toBe(true);
    expect(shouldSendSlowWorkFiller({ ...base, inboundText: "make me a carousel" })).toBe(true);
  });
  it("never fires for calendar, greetings, or when typing exists", () => {
    expect(shouldSendSlowWorkFiller({ ...base, inboundText: "what's on my calendar this week?" })).toBe(
      false,
    );
    expect(shouldSendSlowWorkFiller({ ...base, inboundText: "hey" })).toBe(false);
    expect(
      shouldSendSlowWorkFiller({ ...base, hasTyping: true, inboundText: "draft me 3 posts" }),
    ).toBe(false);
    expect(
      shouldSendSlowWorkFiller({ ...base, photoAckSent: true, inboundText: "draft me 3 posts" }),
    ).toBe(false);
  });
});

describe("splitIntoBubbles", () => {
  it("keeps intentional paragraph beats intact", () => {
    const bubbles = splitIntoBubbles(
      "First thought that stays together.\n\nSecond beat as its own SMS.",
      320,
    );
    expect(bubbles).toEqual([
      "First thought that stays together.",
      "Second beat as its own SMS.",
    ]);
  });

  it("avoids tearing a modest overflow sentence mid-thought", () => {
    const long =
      "I've got your voice locked in from our chat and I'm ready to draft posts that sound like you. " +
      "Next up I'll skim your recent posts and start shaping the first ideas.";
    const soft = 160;
    const bubbles = splitIntoBubbles(long, soft);
    expect(bubbles.every((b) => !b.endsWith(" and") && !b.endsWith(" the"))).toBe(true);
    expect(bubbles.join(" ")).toBe(long);
  });
});
