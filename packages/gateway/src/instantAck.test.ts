import { describe, it, expect } from "vitest";
import { shouldSendInstantTextAck, splitIntoBubbles } from "./gateway.js";

describe("shouldSendInstantTextAck", () => {
  it("skips during active onboarding", () => {
    expect(
      shouldSendInstantTextAck({ onboarding_state: { status: "in_progress" } }, "sounds good"),
    ).toBe(false);
    expect(
      shouldSendInstantTextAck({ onboarding_state: { status: "wrapping_up" } }, "ok"),
    ).toBe(false);
  });

  it("skips affirmations and status checks after onboarding", () => {
    const done = { onboarding_state: { status: "done" as const } };
    expect(shouldSendInstantTextAck(done, "Awesome")).toBe(false);
    expect(shouldSendInstantTextAck(done, "are you done?")).toBe(false);
    expect(shouldSendInstantTextAck(done, "still working?")).toBe(false);
  });

  it("allows normal post-setup chat acks", () => {
    expect(
      shouldSendInstantTextAck({ onboarding_state: { status: "done" } }, "can you make it shorter"),
    ).toBe(true);
  });

  it("skips plan rebuild asks and scratch confirms", () => {
    const done = { onboarding_state: { status: "done" as const } };
    expect(shouldSendInstantTextAck(done, "From scratch")).toBe(false);
    expect(shouldSendInstantTextAck(done, "Can you rerun the plan build")).toBe(false);
    expect(shouldSendInstantTextAck(done, "rebuild my niche plan")).toBe(false);
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
