import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeAffirmation } from "../classify.js";
import { planOverrunNudge, ONBOARDING_PLAN_ETA_MINUTES } from "../nichePlan.js";
import { WRAP_ACK } from "../onboarding.js";
import { WRAP_ACK_PREFIX } from "../conversationContext.js";

describe("looksLikeAffirmation", () => {
  it("detects pure vibes that aren't actionable approvals", () => {
    expect(looksLikeAffirmation("Awesome")).toBe(true);
    expect(looksLikeAffirmation("awesome!")).toBe(true);
    expect(looksLikeAffirmation("Love that")).toBe(true);
    expect(looksLikeAffirmation("nice one")).toBe(true);
  });

  it("does not swallow explicit yes/approve", () => {
    expect(looksLikeAffirmation("yes")).toBe(false);
    expect(looksLikeAffirmation("approve")).toBe(false);
    expect(looksLikeAffirmation("go for it")).toBe(false);
  });
});

describe("plan ETA helpers", () => {
  it("quotes a concrete onboarding ETA", () => {
    expect(ONBOARDING_PLAN_ETA_MINUTES).toBe(2);
    expect(planOverrunNudge(2)).toMatch(/about 2 more minutes/i);
  });

  it("does not send the overrun immediately when research is not ready", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../gateway/src/gateway.ts"), "utf8");
    expect(src).toMatch(/worker nudges after promised_at/);
    expect(src).toMatch(/ownerMovedOnSinceWrapAck/);
  });

  it("ties wrap-ack detection to the live WRAP_ACK SMS", () => {
    expect(WRAP_ACK.startsWith(WRAP_ACK_PREFIX)).toBe(true);
  });
});
