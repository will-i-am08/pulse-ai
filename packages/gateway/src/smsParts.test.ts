import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_SMS_PART_CHARS, clampSmsParts, splitIntoBubbles } from "./gateway.js";

/**
 * Regression pins for the "client receives nothing" class of bug.
 *
 * Twilio rejects a body over 1600 chars outright (error 21617) and delivers
 * NOTHING. `sendToBrand` used to skip splitting entirely whenever `pace: false`
 * was passed — which is exactly what every long-form send uses (the onboarding
 * voice rundown, and an explicit-ask content plan). A real content plan
 * measures ~2200 chars, so a client who asked for the plan received silence.
 */
describe("clampSmsParts", () => {
  it("leaves parts under the ceiling untouched", () => {
    const parts = ["short", "also short"];
    expect(clampSmsParts(parts)).toEqual(parts);
  });

  it("chops a part that exceeds the provider body limit", () => {
    const huge = "x".repeat(MAX_SMS_PART_CHARS * 2 + 37);

    const out = clampSmsParts([huge]);

    expect(out.length).toBe(3);
    for (const part of out) expect(part.length).toBeLessThanOrEqual(MAX_SMS_PART_CHARS);
    expect(out.join("")).toBe(huge);
  });

  it("keeps every part within Twilio's hard 1600-char body limit", () => {
    // The ceiling exists to stay clear of 21617; assert the margin explicitly
    // so nobody "optimises" MAX_SMS_PART_CHARS up past the provider limit.
    expect(MAX_SMS_PART_CHARS).toBeLessThan(1600);
  });

  it("splits a realistic onboarding content plan into sendable parts", () => {
    // Shaped like an explicit-ask content plan: long, multi-line, no single
    // line near the limit — the case that previously went out as one body.
    const plan = Array.from(
      { length: 40 },
      (_, i) => `${i + 1}. A content pillar line with enough words in it to look like a real plan entry.`,
    ).join("\n");
    expect(plan.length).toBeGreaterThan(2000);

    const parts = clampSmsParts(splitIntoBubbles(plan));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SMS_PART_CHARS);
  });
});

describe("onboarding wrap SMS", () => {
  it("delivers rundown.main only — no afterthought or deferred plan SMS", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./gateway.ts"), "utf8");
    const wrap = src.slice(src.indexOf("if (finishOnboardingBrandId)"));
    expect(wrap).toMatch(/await deliver\(brandId, rundown\.main/);
    expect(wrap).not.toMatch(/rundown\.afterthought/);
    expect(wrap).not.toMatch(/buildOnboardingPlanSms/);
    expect(wrap).not.toMatch(/I'll text you in about/);
    expect(src).not.toMatch(/setTimeout\([\s\S]{0,500}buildOnboardingPlanSms/);
  });
});

describe("mediaIdsFromPublicUrls", () => {
  it("extracts media UUIDs from public preview URLs and skips vCards", async () => {
    const { mediaIdsFromPublicUrls } = await import("./gateway.js");
    const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(
      mediaIdsFromPublicUrls([
        `https://web.example/api/media/${a}`,
        `/api/media/${b}`,
        "https://web.example/kip.vcf",
        "https://web.example/api/media/not-a-uuid",
      ]),
    ).toEqual([a, b]);
  });
});
