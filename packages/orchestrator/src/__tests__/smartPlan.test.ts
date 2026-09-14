import { describe, expect, it } from "vitest";
import { looksLikeMultiStepAsk, parseSmartPlan } from "../smartPlan.js";

describe("looksLikeMultiStepAsk", () => {
  it("is false for short single-verb asks", () => {
    expect(looksLikeMultiStepAsk("draft a post")).toBe(false);
    expect(looksLikeMultiStepAsk("hi")).toBe(false);
  });

  it("detects then / and also / multi-and with work verbs", () => {
    expect(looksLikeMultiStepAsk("research my niche then draft 3 posts")).toBe(true);
    expect(looksLikeMultiStepAsk("make a carousel and also write a story")).toBe(true);
    expect(looksLikeMultiStepAsk("plan the week and draft two posts and schedule")).toBe(true);
  });

  it("requires a work verb for long messages", () => {
    const longChat = "a".repeat(100);
    expect(looksLikeMultiStepAsk(longChat)).toBe(false);
    expect(looksLikeMultiStepAsk(`${longChat} please draft something`)).toBe(true);
  });
});

describe("parseSmartPlan", () => {
  it("parses a valid plan", () => {
    const raw = JSON.stringify({
      goal: "Draft a carousel then a feed post",
      steps: [
        { action: "draft_carousel", detail: "3 slides" },
        { action: "draft_feed" },
      ],
      kickoffKind: "draft_posts",
      speakHint: "On it — drafting both now.",
      confidence: 0.8,
    });
    const plan = parseSmartPlan(raw);
    expect(plan).not.toBeNull();
    expect(plan!.goal).toMatch(/carousel/);
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.kickoffKind).toBe("draft_posts");
    expect(plan!.speakHint).toMatch(/On it/);
    expect(plan!.confidence).toBe(0.8);
  });

  it("returns null on low confidence", () => {
    expect(
      parseSmartPlan(
        JSON.stringify({
          goal: "maybe something",
          steps: [{ action: "draft" }],
          confidence: 0.2,
        }),
      ),
    ).toBeNull();
  });

  it("returns null on missing goal / steps", () => {
    expect(parseSmartPlan("{}")).toBeNull();
    expect(parseSmartPlan(JSON.stringify({ goal: "x", steps: [], confidence: 0.9 }))).toBeNull();
    expect(parseSmartPlan("not json")).toBeNull();
  });

  it("nulls invalid kickoffKind rather than inventing", () => {
    const plan = parseSmartPlan(
      JSON.stringify({
        goal: "publish now",
        steps: [{ action: "publish" }],
        kickoffKind: "publish_now",
        confidence: 0.9,
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.kickoffKind).toBeNull();
  });

  it("caps steps at 4", () => {
    const plan = parseSmartPlan(
      JSON.stringify({
        goal: "many steps",
        steps: [
          { action: "a" },
          { action: "b" },
          { action: "c" },
          { action: "d" },
          { action: "e" },
        ],
        confidence: 0.7,
      }),
    );
    expect(plan!.steps).toHaveLength(4);
  });

  it("extracts JSON from surrounding prose", () => {
    const plan = parseSmartPlan(
      'Sure.\n{"goal":"Draft two","steps":[{"action":"draft"}],"confidence":0.6}\n',
    );
    expect(plan?.goal).toBe("Draft two");
  });
});
