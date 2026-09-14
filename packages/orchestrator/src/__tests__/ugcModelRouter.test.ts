import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  STILL_MODELS,
  MOTION_MODELS,
  resolveStillChain,
  resolveMotionChain,
  buildStillInput,
  buildMotionInput,
} from "../ugc/modelRouter.js";

describe("ugc modelRouter — multi-model, not Nano-Banana-only", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      "UGC_STILL_MODEL",
      "UGC_STILL_FALLBACKS",
      "UGC_MOTION_MODEL",
      "UGC_MOTION_FALLBACKS",
      "FAL_NANO_BANANA_MODEL",
      "FAL_SEEDANCE_I2V_MODEL",
    ]) {
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

  it("catalog includes Nano Banana, Flux, Seedream, Kling, Seedance, Wan", () => {
    expect(Object.keys(STILL_MODELS).sort()).toEqual(["flux_dev", "nano_banana", "seedream"]);
    expect(Object.keys(MOTION_MODELS).sort()).toEqual(["kling", "seedance", "wan"]);
  });

  it("defaults stills to nano_banana with flux/seedream fallbacks", () => {
    const chain = resolveStillChain();
    expect(chain[0]?.id).toBe("nano_banana");
    expect(chain.map((c) => c.id)).toEqual(["nano_banana", "flux_dev", "seedream"]);
  });

  it("defaults motion to kling with seedance/wan fallbacks", () => {
    const chain = resolveMotionChain();
    expect(chain.map((c) => c.id)).toEqual(["kling", "seedance", "wan"]);
  });

  it("can prefer Seedance as primary motion model via env", () => {
    process.env.UGC_MOTION_MODEL = "seedance";
    process.env.UGC_MOTION_FALLBACKS = "kling,wan";
    const chain = resolveMotionChain();
    expect(chain.map((c) => c.id)).toEqual(["seedance", "kling", "wan"]);
    expect(chain[0]?.falId.toLowerCase()).toContain("seedance");
  });

  it("builds family-specific still inputs", () => {
    const nano = buildStillInput("nano_banana", { prompt: "latte", aspectRatio: "9:16" });
    expect(nano.aspect_ratio).toBe("9:16");
    const flux = buildStillInput("flux", { prompt: "latte" });
    expect(flux.image_size || flux.aspect_ratio).toBeTruthy();
  });

  it("builds kling vs seedance motion inputs differently", () => {
    const kling = buildMotionInput("kling", {
      prompt: "handheld",
      startImageUrl: "https://example.com/a.jpg",
    });
    expect(kling.start_image_url).toBe("https://example.com/a.jpg");

    const seedance = buildMotionInput("seedance", {
      prompt: "handheld",
      startImageUrl: "https://example.com/a.jpg",
    });
    expect(seedance.image_url).toBe("https://example.com/a.jpg");
  });

  it("allows fal path override via env without code changes", () => {
    process.env.UGC_STILL_MODEL = "nano_banana";
    process.env.UGC_STILL_FALLBACKS = "";
    process.env.FAL_NANO_BANANA_MODEL = "fal-ai/nano-banana-pro";
    const chain = resolveStillChain();
    expect(chain[0]?.falId).toBe("fal-ai/nano-banana-pro");
  });
});
