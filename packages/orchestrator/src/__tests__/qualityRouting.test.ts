import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  stillChainForQuality,
  routeFeedPhoto,
  type CreativeQuality,
} from "../modelRouter.js";
import { generatePhotoImage } from "../imaging.js";

describe("stillChainForQuality / routeFeedPhoto", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["UGC_STILL_MODEL", "UGC_STILL_FALLBACKS"]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("draft chain differs from premium", () => {
    const draft = stillChainForQuality("draft");
    const premium = stillChainForQuality("premium", "cinematic premium editorial");
    expect(draft[0]).toBe("flux_dev");
    expect(draft).not.toEqual(premium);
    expect(draft.length).toBeGreaterThan(0);
    expect(premium.length).toBeGreaterThan(0);
  });

  it("standard uses default still chain order", () => {
    expect(stillChainForQuality("standard")).toEqual([
      "nano_banana",
      "flux_dev",
      "seedream",
    ]);
  });

  it("routeFeedPhoto returns quality + reason", () => {
    for (const q of ["draft", "standard", "premium"] as CreativeQuality[]) {
      const r = routeFeedPhoto(q);
      expect(r.quality).toBe(q);
      expect(r.reason.length).toBeGreaterThan(5);
    }
  });
});

describe("generatePhotoImage signature", () => {
  it("remains callable with 1–2 args; optional quality is third", () => {
    // Default params → length is 1 (only `prompt` is required).
    expect(generatePhotoImage.length).toBe(1);
    const twoArg: Parameters<typeof generatePhotoImage> = ["cafe interior", "4:5"];
    const threeArg: Parameters<typeof generatePhotoImage> = [
      "cafe interior",
      "4:5",
      { quality: "draft", brief: "quick draft" },
    ];
    expect(twoArg).toHaveLength(2);
    expect(threeArg[2]?.quality).toBe("draft");
  });
});
