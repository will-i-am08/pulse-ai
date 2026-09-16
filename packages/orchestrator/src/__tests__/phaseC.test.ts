import { describe, expect, it } from "vitest";
import { weightsFromFormatMix } from "../formats.js";
import { layoutForIndex, pickLayoutVariant, rolesForCarouselKind } from "../designComposer.js";
import { brandPhotoStyleBits, shouldOverlayHeadline, messageWantsText } from "../imaging.js";
import { routeImageJob } from "../modelRouter.js";
import { heuristicDesignQa, designQaFailureSms } from "../designQa.js";
import { mapWithConcurrency } from "../concurrency.js";
import type { Brand } from "@pulse/shared";

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Cafe",
    account_type: "business",
    brand_voice_profile: {
      tone: [],
      dos: [],
      donts: [],
      example_captions: [],
      banned_words: [],
      emoji_policy: "sparing",
      hashtag_policy: "",
      notes: [],
      writing_mechanics: {},
      photo_style: {
        overall_aesthetic: "warm natural",
        lighting: "soft window light",
        composition: "flat lay",
        colour_palette: ["#c4a484", "#2b2118"],
        editing: "gentle warmth",
        common_subjects: ["pastries"],
        framing: "overhead",
        recurring_motifs: ["linen"],
      },
      analysis_source: "",
    },
    visual: {
      colors: ["#2b2118", "#f5f0e8"],
      fonts: ["Playfair Display"],
      aesthetic: "warm editorial",
      photo_treatment: "natural, true-to-product",
    },
    ...over,
  } as Brand;
}

describe("C5 format_bias / format_mix", () => {
  it("parses percentage mix into weights", () => {
    const w = weightsFromFormatMix("carousel-heavy — ~50% carousel, 30% feed, 20% story");
    expect(w).toEqual([
      ["carousel", 50],
      ["feed", 30],
      ["story", 20],
    ]);
  });

  it("returns null when mix has no percentages", () => {
    expect(weightsFromFormatMix("mostly carousels")).toBeNull();
    expect(weightsFromFormatMix(null)).toBeNull();
  });
});

describe("C7 composer variation helpers", () => {
  it("layoutForIndex varies across slides in one carousel", () => {
    const layouts = [0, 1, 2, 3, 4].map((i) => layoutForIndex(i, 5));
    expect(new Set(layouts).size).toBeGreaterThan(1);
  });

  it("pickLayoutVariant avoids the last three when alternatives exist", () => {
    const recent = ["centered_stack", "bottom_band", "top_masthead"] as const;
    for (let i = 0; i < 20; i++) {
      const picked = pickLayoutVariant([...recent]);
      expect(recent.includes(picked as (typeof recent)[number])).toBe(false);
    }
  });

  it("rolesForCarouselKind maps typed generators", () => {
    expect(rolesForCarouselKind("before_after", 4)).toEqual(["hook", "before", "after", "cta"]);
    expect(rolesForCarouselKind("steps", 4)[1]).toBe("step");
    expect(rolesForCarouselKind("menu_offer", 4)[0]).toBe("hook");
    expect(rolesForCarouselKind("tip", 5)[4]).toBe("cta");
  });
});

describe("C1 photo_style + headline defaults", () => {
  it("brandPhotoStyleBits includes voice photo_style when present", () => {
    const bits = brandPhotoStyleBits(fakeBrand());
    expect(bits.join(" ")).toMatch(/warm natural/);
    expect(bits.join(" ")).toMatch(/soft window light/);
    expect(bits.join(" ")).toMatch(/#2b2118/);
  });

  it("shouldOverlayHeadline is smarter than messageWantsText alone for business", () => {
    const brand = fakeBrand();
    expect(messageWantsText("here's a photo")).toBe(false);
    expect(shouldOverlayHeadline(brand, "here's a photo", { format: "feed" })).toBe(true);
    expect(shouldOverlayHeadline(brand, "no text on this one", { format: "feed" })).toBe(false);
    expect(shouldOverlayHeadline(brand, "add a headline please", { format: "feed" })).toBe(true);
    expect(
      shouldOverlayHeadline(brand, "post this", { caption: "20% off flat whites today", format: "feed" }),
    ).toBe(true);
    expect(
      shouldOverlayHeadline(brand, "carousel with cinematic photos with text over the top", {
        format: "carousel",
      }),
    ).toBe(true);
    expect(shouldOverlayHeadline(fakeBrand({ account_type: "personal" }), "cool pic", { format: "feed" })).toBe(
      false,
    );
  });
});

describe("C4 story caption path", () => {
  it("stories default toward overlay (unless no-text)", () => {
    const brand = fakeBrand();
    expect(shouldOverlayHeadline(brand, null, { format: "story" })).toBe(true);
    expect(shouldOverlayHeadline(brand, "leave it candid", { format: "story" })).toBe(false);
  });
});

describe("C9 model router", () => {
  it("routes photo → flux and designed slides → composer", () => {
    expect(routeImageJob("photo_edit").engine).toBe("flux");
    expect(routeImageJob("photo_generate").engine).toBe("flux");
    expect(routeImageJob("designed_slide").engine).toBe("composer");
  });

  it("falls back specialty to composer when env flags unset", () => {
    delete process.env.REPLICATE_IDEOGRAM_MODEL;
    delete process.env.REPLICATE_RECRAFT_MODEL;
    expect(routeImageJob("specialty_poster").engine).toBe("composer");
    expect(routeImageJob("specialty_illustration").engine).toBe("composer");
  });
});

describe("C8 design QA helpers", () => {
  it("heuristic fails empty / overflow copy", () => {
    const brand = fakeBrand();
    expect(heuristicDesignQa({ brand, slideTexts: ["ok", ""] }).pass).toBe(false);
    expect(heuristicDesignQa({ brand, slideTexts: ["x".repeat(200)] }).pass).toBe(false);
    expect(heuristicDesignQa({ brand, slideTexts: ["Short tip"] }).pass).toBe(true);
  });

  it("honest failure SMS names the brand", () => {
    expect(designQaFailureSms("Test Cafe")).toMatch(/Test Cafe/);
    expect(designQaFailureSms("Test Cafe")).toMatch(/design check/i);
  });
});

describe("C6 concurrency helper", () => {
  it("maps with a concurrency ceiling and preserves order", async () => {
    const seen: number[] = [];
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(seen).toHaveLength(5);
  });
});
