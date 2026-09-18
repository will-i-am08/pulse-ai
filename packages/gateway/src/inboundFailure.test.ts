import { afterEach, describe, expect, it } from "vitest";
import {
  GLITCH_SMS_COOLDOWN_MS,
  INBOUND_FAILURE_SMS_CONFIG,
  INBOUND_FAILURE_SMS_RETRY,
  classifyInboundFailure,
  inboundFailureOwnerSms,
  resetGlitchSmsCooldown,
  shouldSendGlitchSms,
} from "./inboundFailure.js";

afterEach(() => {
  resetGlitchSmsCooldown();
});

describe("classifyInboundFailure", () => {
  it("marks Invalid time zone :UTC as config", () => {
    const err = new RangeError("Invalid time zone specified: :UTC");
    expect(classifyInboundFailure(err)).toBe("config");
    expect(inboundFailureOwnerSms("config")).toBe(INBOUND_FAILURE_SMS_CONFIG);
    expect(inboundFailureOwnerSms("config")).not.toMatch(/sending it again/i);
  });

  it("marks connection drops as transient", () => {
    expect(classifyInboundFailure(new Error("read ECONNRESET"))).toBe("transient");
    expect(classifyInboundFailure(new Error("Connection terminated unexpectedly"))).toBe(
      "transient",
    );
  });

  it("defaults to unknown → retry copy", () => {
    expect(classifyInboundFailure(new Error("something odd"))).toBe("unknown");
    expect(inboundFailureOwnerSms("unknown")).toBe(INBOUND_FAILURE_SMS_RETRY);
  });
});

describe("shouldSendGlitchSms cooldown", () => {
  it("allows the first SMS then suppresses within the window", () => {
    const t0 = 1_000_000;
    expect(shouldSendGlitchSms("brand-a", t0)).toBe(true);
    expect(shouldSendGlitchSms("brand-a", t0 + 30_000)).toBe(false);
    expect(shouldSendGlitchSms("brand-a", t0 + GLITCH_SMS_COOLDOWN_MS)).toBe(true);
  });

  it("tracks brands independently", () => {
    const t0 = 2_000_000;
    expect(shouldSendGlitchSms("a", t0)).toBe(true);
    expect(shouldSendGlitchSms("b", t0)).toBe(true);
    expect(shouldSendGlitchSms("a", t0 + 1_000)).toBe(false);
  });
});
