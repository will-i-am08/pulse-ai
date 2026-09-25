import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVariantChoice, variantPickSms, lookPackForBrand, frameFeedImage, imagesTooSimilar, buildVariantEditRequest } from "../variants.js";
import {
  resolveLookPackFromNiche,
  parseLookChangeRequest,
  getLookPack,
  LOOK_PACKS_V1,
  PHOTO_EDIT_FAITHFUL_PROHIBITION,
} from "../lookPacks/index.js";

describe("parseVariantChoice", () => {
  it("parses bare 1/2/3", () => {
    expect(parseVariantChoice("1")).toEqual({ kind: "index", index: 0 });
    expect(parseVariantChoice("2")).toEqual({ kind: "index", index: 1 });
    expect(parseVariantChoice("3!")).toEqual({ kind: "index", index: 2 });
  });

  it("parses look N / one two three", () => {
    expect(parseVariantChoice("look 2")).toEqual({ kind: "index", index: 1 });
    expect(parseVariantChoice("option 3")).toEqual({ kind: "index", index: 2 });
    expect(parseVariantChoice("two")).toEqual({ kind: "index", index: 1 });
  });

  it("parses skip and original", () => {
    expect(parseVariantChoice("skip")).toEqual({ kind: "skip" });
    expect(parseVariantChoice("original")).toEqual({ kind: "original" });
    expect(parseVariantChoice("as is")).toEqual({ kind: "original" });
  });

  it("returns null for unrelated text", () => {
    expect(parseVariantChoice("yes")).toBeNull();
    expect(parseVariantChoice("make it brighter")).toBeNull();
    expect(parseVariantChoice("")).toBeNull();
  });
});

describe("variantPickSms", () => {
  const pack = { smsName: "café-warm" } as Parameters<typeof variantPickSms>[0];

  it("asks for 1 or 2 when two looks landed", () => {
    expect(variantPickSms(pack, 2)).toMatch(/Two café-warm looks/i);
    expect(variantPickSms(pack, 2)).toMatch(/Reply 1 or 2/);
    expect(variantPickSms(pack, 2)).not.toMatch(/1, 2, or 3/);
    expect(variantPickSms(pack, 2)).not.toMatch(/✨/);
  });
});

describe("look packs", () => {
  it("maps niches to packs", () => {
    expect(resolveLookPackFromNiche("neighbourhood coffee café").id).toBe("cafe_warm");
    expect(resolveLookPackFromNiche("hair salon in Fitzroy").id).toBe("salon_clean");
    expect(resolveLookPackFromNiche("crossfit gym PT").id).toBe("gym_punchy");
    expect(resolveLookPackFromNiche("local plumber tradie").id).toBe("tradie_daylight");
    expect(resolveLookPackFromNiche("pizza restaurant").id).toBe("food_hero");
    expect(resolveLookPackFromNiche("candle boutique retail").id).toBe("retail_shelf");
    expect(resolveLookPackFromNiche("neighbourhood florist bouquet").id).toBe("florist_bloom");
    expect(resolveLookPackFromNiche("dog groomer in Bondi").id).toBe("salon_clean");
    expect(resolveLookPackFromNiche("emergency electrician sparky").id).toBe("tradie_daylight");
    expect(resolveLookPackFromNiche("random consulting").id).toBe("generic_faithful");
  });

  it("each pack has three variant directions and three distinct frames", () => {
    for (const pack of Object.values(LOOK_PACKS_V1)) {
      expect(pack.variantDirections).toHaveLength(3);
      expect(new Set(pack.variantDirections).size).toBe(3);
      expect(pack.variantFrames).toHaveLength(3);
      expect(new Set(pack.variantFrames).size).toBe(3);
      expect(pack.variantFrames).toEqual(["attention", "centre", "entropy"]);
      expect(pack.defaultAspect).toBe("4:5");
    }
  });

  it("variantDirections are crop-first and subject-agnostic", () => {
    for (const pack of Object.values(LOOK_PACKS_V1)) {
      for (const line of pack.variantDirections) {
        expect(line).toMatch(/crop|framing|establishing/i);
        expect(line).not.toMatch(/petal|bouquet|espresso|hair/i);
      }
    }
  });

  it("parses look change SMS", () => {
    expect(parseLookChangeRequest("change look to salon clean")?.kind).toBe("set");
    expect(parseLookChangeRequest("more lifestyle")).toEqual({
      kind: "hint",
      hint: "more lifestyle context around the real subject",
    });
    expect(parseLookChangeRequest("darker please")).toEqual({
      kind: "hint",
      hint: "darker moodier grade, still readable",
    });
    expect(parseLookChangeRequest("yes post it")).toBeNull();
  });

  it("getLookPack falls back to generic", () => {
    expect(getLookPack("nope").id).toBe("generic_faithful");
    expect(getLookPack("cafe_warm").smsName).toBe("café-warm");
  });

  it("does not treat a lab placeholder name as a café niche", () => {
    expect(
      lookPackForBrand({
        name: "Lab Cafe",
        facts: { lab: true },
        brand_voice_profile: {},
        icp: {},
      } as never).id,
    ).toBe("generic_faithful");
    expect(
      lookPackForBrand({
        name: "Lab Cafe",
        facts: { lab: true, differentiators: "emergency plumber in Brunswick" },
        brand_voice_profile: {},
        icp: {},
      } as never).id,
    ).toBe("tradie_daylight");
  });

  it("florist looks differ by crop, not just grade, and stay subject-agnostic", () => {
    const [close, medium, wide] = LOOK_PACKS_V1.florist_bloom.variantDirections;
    expect(close).toMatch(/tight crop|extreme close/i);
    expect(medium).toMatch(/45-degree|medium/i);
    expect(wide).toMatch(/wider establishing|full subject/i);
    for (const line of [close, medium, wide]) {
      expect(line).not.toMatch(/petal|bouquet|espresso|hair/i);
    }
    expect(new Set(LOOK_PACKS_V1.florist_bloom.variantFrames).size).toBe(3);
  });

  it("generates looks sequentially and retries similar frames", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../variants.ts"),
      "utf8",
    );
    const gen = src.slice(src.indexOf("export async function generatePhotoVariants"));
    expect(gen).toMatch(/for \(let i = 0; i < directions\.length/);
    expect(gen).toMatch(/imagesTooSimilar/);
    expect(gen).toMatch(/retryCrop: attempt === 1/);
    expect(gen).toMatch(/frameFeedImage\(blob\.bytes, gravity\)/);
    expect(gen).not.toMatch(/mapWithConcurrency/);
    expect(src).toMatch(/CROP HARDER/);
    expect(gen).toMatch(/editImageForBrand\(brand, mediaId, request, undefined, \{\s*mode: "variant"/);
    expect(gen).not.toMatch(/generateEditPrompt/);
  });
});

describe("faithful variant edits", () => {
  const OBJECT_NOUNS =
    /\b(van|job site|tools?|pipes?|espresso|mirrors?|steam|ceramic|athletes?|finished jobs?)\b/i;

  it("every pack baseDirection is grade-only (no van/tools/job site)", () => {
    for (const pack of Object.values(LOOK_PACKS_V1)) {
      expect(pack.baseDirection, pack.id).not.toMatch(OBJECT_NOUNS);
      expect(pack.baseDirection, pack.id).not.toMatch(/\bvan\b/i);
      expect(pack.baseDirection, pack.id).not.toMatch(/\btools?\b/i);
      expect(pack.baseDirection, pack.id).not.toMatch(/job site/i);
    }
  });

  it("every pack request includes the faithful prohibition and does not invent a trade scene", () => {
    for (const pack of Object.values(LOOK_PACKS_V1)) {
      const req = buildVariantEditRequest(pack, 0, 3);
      expect(req).toContain(PHOTO_EDIT_FAITHFUL_PROHIBITION);
      expect(req).toMatch(/phone-shot character|slight grain|handheld/i);
      expect(req).not.toMatch(/depict that trade/i);
      expect(req).not.toMatch(/plumber van|tools, job sites|finished jobs/i);
      expect(req).not.toMatch(/restyle this into a café/i);
      expect(req).not.toMatch(/Avoid: /);
    }
  });

  it("generateEditPrompt no longer honours client request above everything / injects trade scenes", () => {
    const imaging = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../imaging.ts"),
      "utf8",
    );
    const start = imaging.indexOf("export async function generateEditPrompt");
    const next = imaging.indexOf("\nasync function replicateEdit");
    const fn = imaging.slice(start, next === -1 ? undefined : next);
    expect(fn).toContain("export async function generateEditPrompt");
    expect(fn).not.toContain("replicateEdit");
    expect(fn).not.toMatch(/creativeSceneConstraint/);
    expect(fn).not.toMatch(/Honour that request above everything else/);
    expect(fn).not.toMatch(/MOST IMPORTANT/);
    expect(fn).toMatch(/phone-shot character|iPhone grain/i);
    expect(fn).toMatch(/unless the (client )?request or brand/i);
    expect(fn).not.toMatch(/like a pro product shoot/);
  });

  it("editImageForBrand variant mode skips generateEditPrompt", () => {
    const imaging = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../imaging.ts"),
      "utf8",
    );
    const start = imaging.indexOf("export async function editImageForBrand");
    const next = imaging.indexOf("export async function gradePhotoBundle");
    const fn = imaging.slice(start, next === -1 ? undefined : next);
    const variantStart = fn.indexOf('if (opts?.mode === "variant")');
    const elseStart = fn.indexOf("} else {", variantStart);
    expect(variantStart).toBeGreaterThan(-1);
    expect(elseStart).toBeGreaterThan(variantStart);
    const variantBlock = fn.slice(variantStart, elseStart);
    expect(variantBlock).not.toMatch(/await generateEditPrompt/);
    expect(fn.slice(elseStart)).toMatch(/await generateEditPrompt/);
    expect(variantBlock).toMatch(/PHOTO_EDIT_FAITHFUL_PROHIBITION/);
  });
});

describe("frameFeedImage gravity", () => {
  it("accepts a gravity argument and crops differently for north vs south", async () => {
    const { default: sharp } = await import("sharp");
    const split = await sharp({
      create: { width: 40, height: 80, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .png()
            .toBuffer(),
          top: 40,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    const north = await frameFeedImage(split, "north");
    const south = await frameFeedImage(split, "south");
    const northStats = await sharp(north).stats();
    const southStats = await sharp(south).stats();
    const northMean = northStats.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
    const southMean = southStats.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
    expect(northMean).toBeGreaterThan(southMean);
  });
});

describe("imagesTooSimilar", () => {
  it("treats identical buffers as similar and black vs white as different", async () => {
    const { default: sharp } = await import("sharp");
    const black = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const white = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    expect(await imagesTooSimilar(black, black)).toBe(true);
    expect(await imagesTooSimilar(black, white)).toBe(false);
  });
});
