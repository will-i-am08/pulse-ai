import { describe, it, expect } from "vitest";
import { parseVariantChoice } from "../variants.js";
import {
  resolveLookPackFromNiche,
  parseLookChangeRequest,
  getLookPack,
  LOOK_PACKS_V1,
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

describe("look packs", () => {
  it("maps niches to packs", () => {
    expect(resolveLookPackFromNiche("neighbourhood coffee café").id).toBe("cafe_warm");
    expect(resolveLookPackFromNiche("hair salon in Fitzroy").id).toBe("salon_clean");
    expect(resolveLookPackFromNiche("crossfit gym PT").id).toBe("gym_punchy");
    expect(resolveLookPackFromNiche("local plumber tradie").id).toBe("tradie_daylight");
    expect(resolveLookPackFromNiche("pizza restaurant").id).toBe("food_hero");
    expect(resolveLookPackFromNiche("candle boutique retail").id).toBe("retail_shelf");
    expect(resolveLookPackFromNiche("random consulting").id).toBe("generic_faithful");
  });

  it("each pack has three variant directions", () => {
    for (const pack of Object.values(LOOK_PACKS_V1)) {
      expect(pack.variantDirections).toHaveLength(3);
      expect(pack.defaultAspect).toBe("4:5");
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
});
