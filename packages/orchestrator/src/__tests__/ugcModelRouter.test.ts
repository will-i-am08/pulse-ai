import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  STILL_MODELS,
  MOTION_MODELS,
  resolveStillChain,
  resolveMotionChain,
  buildStillInput,
  buildMotionInput,
} from "../ugc/modelRouter.js";
import {
  planUgcCreative,
  pickStillIds,
  pickMotionIds,
  pickVoiceSlot,
} from "../ugc/creativePlan.js";

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

  it("auto still default is nano_banana → flux → seedream (safe fallback when no brief)", () => {
    const chain = resolveStillChain();
    expect(chain[0]?.id).toBe("nano_banana");
    expect(chain.map((c) => c.id)).toEqual(["nano_banana", "flux_dev", "seedream"]);
  });

  it("auto motion default is kling → seedance → wan (safe fallback when no brief)", () => {
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


describe("ugc creativePlan — Kip auto-picks per brief", () => {
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["UGC_STILL_MODEL", "UGC_MOTION_MODEL", "UGC_VOICE_MODE", "ELEVENLABS_VOICE_ID", "UGC_STILL_FALLBACKS"]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.UGC_STILL_MODEL = "auto";
    process.env.UGC_MOTION_MODEL = "auto";
    process.env.UGC_VOICE_MODE = "auto";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("picks Nano Banana first when product refs exist", () => {
    const pick = pickStillIds({ brief: "UGC ad for our Saturday latte special", hasProductRefs: true });
    expect(pick.ids[0]).toBe("nano_banana");
  });

  it("picks Flux first for lifestyle briefs without product refs", () => {
    const pick = pickStillIds({ brief: "lifestyle vibe aesthetic morning routine", hasProductRefs: false });
    expect(pick.ids[0]).toBe("flux_dev");
  });

  it("picks Seedance first for cinematic briefs", () => {
    const pick = pickMotionIds({ brief: "cinematic premium film look tracking shot", destination: "organic" });
    expect(pick.ids[0]).toBe("seedance");
  });

  it("picks Kling first for standard ads", () => {
    const pick = pickMotionIds({ brief: "make a UGC ad for our oat milk", destination: "ads" });
    expect(pick.ids[0]).toBe("kling");
  });

  it("picks calm voice for premium/spa tone", () => {
    const pick = pickVoiceSlot({ brief: "soft spa wellness luxury calm morning", brand: null });
    expect(pick.slot).toBe("calm");
  });

  it("picks casual_m for male voice cues", () => {
    const pick = pickVoiceSlot({ brief: "use a male voice for guys who lift", brand: null });
    expect(pick.slot).toBe("casual_m");
  });

  it("planUgcCreative returns auto mode with still/motion/voice", () => {
    const plan = planUgcCreative({
      brief: "UGC reel for our cold brew, busy mornings",
      hasProductRefs: true,
      destination: "organic",
    });
    expect(plan.mode).toBe("auto");
    expect(plan.still[0]?.id).toBe("nano_banana");
    expect(plan.motion[0]?.id).toBe("kling");
    expect(plan.voiceSlot).toBe("casual_f");
  });

  it("respects pinned still model env", () => {
    process.env.UGC_STILL_MODEL = "seedream";
    process.env.UGC_STILL_FALLBACKS = "flux_dev";
    const plan = planUgcCreative({
      brief: "UGC reel for our cold brew",
      hasProductRefs: true,
      destination: "organic",
    });
    expect(plan.mode).toBe("pinned");
    expect(plan.still.map((c) => c.id)).toEqual(["seedream", "flux_dev"]);
  });
});
