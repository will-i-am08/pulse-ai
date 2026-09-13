import { describe, expect, it } from "vitest";
import { shouldSendInstantTextAck } from "./gateway.js";

describe("shouldSendInstantTextAck", () => {
  it("skips during active onboarding (interview / connect / contact)", () => {
    for (const status of [
      "pending",
      "awaiting_contact",
      "awaiting_connect",
      "reading_content",
      "in_progress",
      "wrapping_up",
    ] as const) {
      expect(shouldSendInstantTextAck({ onboarding_state: { status } })).toBe(false);
    }
  });

  it("allows after onboarding is done", () => {
    expect(shouldSendInstantTextAck({ onboarding_state: { status: "done" } })).toBe(true);
    expect(shouldSendInstantTextAck({ onboarding_state: { status: "none" } })).toBe(true);
  });
});
