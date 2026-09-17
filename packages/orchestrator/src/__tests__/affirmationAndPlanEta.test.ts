import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeAffirmation } from "../classify.js";
import { WRAP_ACK } from "../onboarding.js";
import { WRAP_ACK_PREFIX } from "../conversationContext.js";

const here = dirname(fileURLToPath(import.meta.url));

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
  it("never SMS a plan ETA, overrun, or auto-dumped plan after wrap", () => {
    const gateway = readFileSync(join(here, "../../../gateway/src/gateway.ts"), "utf8");
    expect(gateway).toMatch(/const rundown = await finishOnboarding\(brandId\)/);
    expect(gateway).toMatch(/await deliver\(brandId, rundown\.main/);
    expect(gateway).not.toMatch(/rundown\.afterthought/);
    expect(gateway).not.toMatch(/buildOnboardingPlanSms/);
    expect(gateway).not.toMatch(/I'll text you in about/);
    expect(gateway).not.toMatch(/setTimeout\([\s\S]{0,500}buildOnboardingPlanSms/);

    const onboarding = readFileSync(join(here, "../onboarding.ts"), "utf8");
    expect(onboarding).toMatch(/export type OnboardingRundown = \{\s*main: string;\s*\}/);
    expect(onboarding).toMatch(/return \{\s*main: `\$\{recap\}\\n\\n\$\{nextStepFor/);
    expect(onboarding).toMatch(/\$\{step\.reply\}\\n\\n\$\{rundown\.main\}/);
    expect(onboarding).not.toMatch(/afterthought/);
    expect(onboarding).not.toMatch(/I'll text you in about/);

    const worker = readFileSync(
      join(here, "../../../../apps/worker/src/proactive/nichePlan.ts"),
      "utf8",
    );
    expect(worker).toMatch(/markPlanProposed/);
    expect(worker).not.toMatch(/sendToBrand/);
    expect(worker).not.toMatch(/planOverrunNudge/);
  });

  it("ties wrap-ack detection to the live WRAP_ACK SMS", () => {
    expect(WRAP_ACK.startsWith(WRAP_ACK_PREFIX)).toBe(true);
  });
});
