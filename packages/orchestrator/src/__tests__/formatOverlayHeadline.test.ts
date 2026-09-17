import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatOverlayHeadline,
  overlaySafeInset,
  OVERLAY_HEADLINE_MAX_WORDS,
  OVERLAY_HEADLINE_MAX_CHARS,
  OVERLAY_TRAILING_FUNCTION_WORDS,
} from "../imaging.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("formatOverlayHeadline", () => {
  it("caps a 12-word line to 5 words and 28 chars", () => {
    const out = formatOverlayHeadline(
      "Twelve word headline that is way too long for the overlay crop",
    );
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_WORDS);
    expect(out.length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(5);
  });

  it("strips punctuation and quotes", () => {
    expect(formatOverlayHeadline(`"Hello, world's best!"`)).toBe("HELLO WORLDS BEST");
    expect(formatOverlayHeadline("\u2018Peak Season\u2019 \u2014 2024")).toBe("PEAK SEASON 2024");
  });

  it("preserves an already-short line (uppercased)", () => {
    expect(formatOverlayHeadline("brew better")).toBe("BREW BETTER");
  });

  it("returns empty for blank input", () => {
    expect(formatOverlayHeadline("")).toBe("");
    expect(formatOverlayHeadline("   ")).toBe("");
  });

  it("keeps an already-5-short-word line", () => {
    expect(formatOverlayHeadline("brew better every single day")).toBe("BREW BETTER EVERY SINGLE DAY");
    expect("BREW BETTER EVERY SINGLE DAY".length).toBe(28);
  });

  it("keeps a 28-char exact line", () => {
    const exact = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    expect(exact.length).toBe(OVERLAY_HEADLINE_MAX_CHARS);
    expect(formatOverlayHeadline(exact.toLowerCase())).toBe(exact);
  });

  it("turns hyphenated junk into spaced words then caps", () => {
    const out = formatOverlayHeadline("too-long-hyphenated-headline-that-smashes");
    expect(out).not.toMatch(/-/);
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(out.length).toBeLessThanOrEqual(28);
    expect(out).toBe("TOO LONG HYPHENATED HEADLINE");
  });

  it("matches the burn-gate layout numbers", () => {
    expect(OVERLAY_HEADLINE_MAX_WORDS).toBe(5);
    expect(OVERLAY_HEADLINE_MAX_CHARS).toBe(28);
    expect(overlaySafeInset(1080)).toBeGreaterThanOrEqual(140);
    expect(overlaySafeInset(200)).toBe(64);
    expect(formatOverlayHeadline("START HERE")).toBe("START HERE");
  });

  it("strips trailing function words left by the word/char cap", () => {
    expect(formatOverlayHeadline("WARM UP SETS BUILD THE")).toBe("WARM UP SETS BUILD");
    expect(formatOverlayHeadline("WARM UP SETS PREP NOT")).toBe("WARM UP SETS PREP");
    expect(formatOverlayHeadline("THE BEST COFFEE IN")).toBe("THE BEST COFFEE");
    expect(formatOverlayHeadline("WARM UP SETS OF THE")).toBe("WARM UP SETS");
    expect(OVERLAY_TRAILING_FUNCTION_WORDS.has("THE")).toBe(true);
    expect(OVERLAY_TRAILING_FUNCTION_WORDS.has("NOT")).toBe(true);
  });

  it("never ends a multi-word overlay on a function word, including after the 28-char slice", () => {
    const samples = [
      "WARM UP SETS BUILD THE",
      "WARM UP SETS PREP NOT",
      "STRENGTHENING COMPOUND LIFTS FOR THE",
      "SUPERCALIFRAGILISTICEXPIALIDOCIOUS THE",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ12 THE",
      "READY TO",
      "TRAIN FOR",
      "GAME OVER",
      "PREP NOT",
      "SETS BUILD THE FOUNDATION NOW",
      "FROM INTO OVER UNDER UP",
      "AS IS ARE BE WAS WERE",
    ];
    for (const s of samples) {
      const out = formatOverlayHeadline(s);
      expect(out.length, s).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
      const parts = out.split(/\s+/).filter(Boolean);
      expect(parts.length, s).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_WORDS);
      if (parts.length > 1) {
        expect(
          OVERLAY_TRAILING_FUNCTION_WORDS.has(parts[parts.length - 1]!),
          `${s} -> ${out}`,
        ).toBe(false);
      }
    }
    const sliced = formatOverlayHeadline("SUPERCALIFRAGILISTICEXPIALIDOCIOUS THE");
    expect(sliced.length).toBeLessThanOrEqual(28);
    expect(sliced.endsWith(" THE")).toBe(false);
    expect(sliced.split(/\s+/).filter(Boolean)).not.toContain("THE");
  });
});

describe("overlay headline wiring", () => {
  it("generateHeadline, applyTextTile, and applyStoryCreative still format", () => {
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const generateHeadline = imaging.slice(
      imaging.indexOf("export async function generateHeadline"),
      imaging.indexOf("export function overlaySafeInset"),
    );
    expect(generateHeadline).toMatch(/formatOverlayHeadline\(/);
    expect(generateHeadline).toMatch(/2-5 word/);
    expect(generateHeadline).toMatch(/Never end on a function word/);
    expect(generateHeadline).not.toMatch(/4-12/);

    const applyTextTile = imaging.slice(
      imaging.indexOf("export async function applyTextTile"),
      imaging.indexOf("export async function applyStoryCreative"),
    );
    expect(applyTextTile).toMatch(/formatOverlayHeadline\(/);

    const applyStoryCreative = imaging.slice(imaging.indexOf("export async function applyStoryCreative"));
    expect(applyStoryCreative).toMatch(/formatOverlayHeadline\(/);
    expect(applyStoryCreative).toMatch(/letterSpacing: "0\.06em"/);
    expect(applyStoryCreative).toMatch(/overlaySafeInset\(/);

    const renderTile = imaging.slice(
      imaging.indexOf("async function renderTile"),
      imaging.indexOf("export async function applyTextTile"),
    );
    expect(renderTile).toMatch(/letterSpacing: "0\.06em"/);
    expect(renderTile).toMatch(/overlaySafeInset\(/);
  });

  it("fillers overlay prompt is 2-5 words, not 4-12", () => {
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    expect(fillers).toMatch(/"card":"<2-5 word overlay headline>"/);
    expect(fillers).not.toMatch(/4-12 word overlay/);
    expect(fillers).toMatch(/wantPhoto\s*\n\s*\? formatOverlayHeadline\(/);
  });

  it("formats overlay titles max 5 words and does not headline idea_blurb", () => {
    const formats = readFileSync(join(here, "../formats.ts"), "utf8");
    expect(formats).toMatch(/"overlay":"<max 5 words>"/);
    expect(formats).toMatch(/"overlay":"<idea title max 5 words>"/);
    expect(formats).toMatch(/Never end an overlay on a function word/);
    expect(formats).toMatch(/overlay:\s*formatOverlayHeadline\(/);
    expect(formats).not.toMatch(/ideaBlurb:\s*formatOverlayHeadline/);
    expect(formats).not.toMatch(/formatOverlayHeadline\([^)]*ideaBlurb/);
    expect(formats).not.toMatch(/formatOverlayHeadline\([^)]*idea_blurb/);
    expect(formats).toMatch(/idea_blurb":"<2 sentences burned on the slide/);
  });
});
