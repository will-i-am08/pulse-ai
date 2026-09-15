import { describe, expect, it } from "vitest";
import {
  clampMemoryText,
  durablePrefFromCorrectionNote,
  kipMemoryPromptBlock,
  mergeKipMemoryFact,
  readKipDecisions,
  readKipPreferences,
} from "../kipMemory.js";

describe("kipMemory readers", () => {
  it("readKipPreferences / readKipDecisions return empty for missing facts", () => {
    expect(readKipPreferences(null)).toEqual([]);
    expect(readKipDecisions(undefined)).toEqual([]);
    expect(readKipPreferences({})).toEqual([]);
  });

  it("reads stored entries", () => {
    const facts = {
      kip_preferences: [{ text: "prefer carousels", atISO: "2026-01-01T00:00:00.000Z" }],
      kip_decisions: [{ text: "skip stories this week", atISO: "2026-01-02T00:00:00.000Z" }],
    };
    expect(readKipPreferences(facts)).toHaveLength(1);
    expect(readKipDecisions(facts)[0]?.text).toBe("skip stories this week");
  });
});

describe("kipMemoryPromptBlock", () => {
  it("returns empty string when no memory", () => {
    expect(kipMemoryPromptBlock(null)).toBe("");
    expect(kipMemoryPromptBlock({})).toBe("");
  });

  it("formats preferences and decisions (max ~6 each)", () => {
    const prefs = Array.from({ length: 8 }, (_, i) => ({
      text: `pref ${i}`,
      atISO: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
    }));
    const block = kipMemoryPromptBlock({
      kip_preferences: prefs,
      kip_decisions: [{ text: "hold Reels", atISO: "2026-02-01T00:00:00.000Z" }],
    });
    expect(block).toMatch(/Remembered preferences:/);
    expect(block).toMatch(/Recent decisions:/);
    expect(block).toMatch(/hold Reels/);
    // Last 6 prefs only
    expect(block).toMatch(/pref 7/);
    expect(block).not.toMatch(/pref 0/);
    expect(block).toMatch(/Honour these/);
  });

  it("truncates long entry text", () => {
    const long = "x".repeat(150);
    const block = kipMemoryPromptBlock({
      kip_preferences: [{ text: long, atISO: "2026-01-01T00:00:00.000Z" }],
    });
    expect(block.length).toBeLessThan(long.length + 80);
    expect(block).toMatch(/…/);
  });
});

describe("mergeKipMemoryFact", () => {
  it("appends under kip_preferences / kip_decisions", () => {
    const merged = mergeKipMemoryFact({}, "kip_preferences", "no emojis", "2026-09-14T12:00:00.000Z");
    expect(merged.kip_preferences).toEqual([
      { text: "no emojis", atISO: "2026-09-14T12:00:00.000Z" },
    ]);
    const again = mergeKipMemoryFact(merged, "kip_decisions", "skip stories this week");
    expect(again.kip_decisions?.[0]?.text).toBe("skip stories this week");
    expect(again.kip_preferences).toHaveLength(1);
  });

  it("clamps text and bounds list length", () => {
    expect(clampMemoryText("  hi   there  ")).toBe("hi there");
    let facts: ReturnType<typeof mergeKipMemoryFact> = {};
    for (let i = 0; i < 25; i++) {
      facts = mergeKipMemoryFact(facts, "kip_preferences", `n${i}`);
    }
    expect(facts.kip_preferences).toHaveLength(20);
    expect(facts.kip_preferences?.at(-1)?.text).toBe("n24");
  });
});

describe("durablePrefFromCorrectionNote", () => {
  it("accepts clear preference language", () => {
    expect(durablePrefFromCorrectionNote("Prefer shorter captions")).toMatch(/Prefer shorter/);
    expect(durablePrefFromCorrectionNote("Avoid exclamation marks")).toBeTruthy();
  });

  it("skips noisy or weak notes", () => {
    expect(durablePrefFromCorrectionNote('Edited: "a" -> "b"')).toBeNull();
    expect(durablePrefFromCorrectionNote("ok")).toBeNull();
    expect(durablePrefFromCorrectionNote("Made it punchier somehow")).toBeNull();
  });
});
