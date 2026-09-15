import { getServerEnv } from "@pulse/shared";

/**
 * UGC model catalog + router.
 *
 * Roles (not vendors):
 * - still: product/scene images (Nano Banana, Flux, Seedream, …)
 * - motion: image→video (Kling, Seedance, Wan, …)
 *
 * Default env is `auto` — Kip's creative planner picks per brief.
 * Pin with UGC_STILL_MODEL / UGC_MOTION_MODEL set to a catalog id.
 * fal.ai is the transport; model IDs are swappable.
 */

export type UgcStillModelId = "nano_banana" | "flux_dev" | "seedream";
export type UgcMotionModelId = "kling" | "seedance" | "wan";

export type UgcModelEndpoint = {
  id: string;
  label: string;
  /** fal model path */
  falId: string;
  /** How to shape fal input for this family */
  family: "nano_banana" | "flux" | "seedream" | "kling" | "seedance" | "wan";
};

export const STILL_MODELS: Record<UgcStillModelId, UgcModelEndpoint> = {
  nano_banana: {
    id: "nano_banana",
    label: "Nano Banana (Gemini image)",
    falId: "fal-ai/nano-banana",
    family: "nano_banana",
  },
  flux_dev: {
    id: "flux_dev",
    label: "Flux Dev",
    falId: "fal-ai/flux/dev",
    family: "flux",
  },
  seedream: {
    id: "seedream",
    label: "Seedream 4",
    falId: "fal-ai/bytedance/seedream/v4/text-to-image",
    family: "seedream",
  },
};

export const MOTION_MODELS: Record<UgcMotionModelId, UgcModelEndpoint> = {
  kling: {
    id: "kling",
    label: "Kling I2V",
    falId: "fal-ai/kling-video/v2.1/standard/image-to-video",
    family: "kling",
  },
  seedance: {
    id: "seedance",
    label: "Seedance 2.0 I2V",
    falId: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    family: "seedance",
  },
  wan: {
    id: "wan",
    label: "Wan I2V",
    falId: "fal-ai/wan/v2.1/image-to-video",
    family: "wan",
  },
};

function envString(key: string, fallback: string): string {
  try {
    const e = getServerEnv() as Record<string, unknown>;
    const v = e[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  const raw = process.env[key];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function parseIdList(raw: string, allowed: string[]): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s));
}

function isAutoModelEnv(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return !t || t === "auto" || t === "best" || t === "kip";
}

function applyStillFalOverrides(base: UgcModelEndpoint, id: string): UgcModelEndpoint {
  if (id === "nano_banana") {
    return { ...base, falId: envString("FAL_NANO_BANANA_MODEL", base.falId) };
  }
  if (id === "flux_dev") {
    return { ...base, falId: envString("FAL_FLUX_STILL_MODEL", base.falId) };
  }
  if (id === "seedream") {
    return { ...base, falId: envString("FAL_SEEDREAM_MODEL", base.falId) };
  }
  return base;
}

function applyMotionFalOverrides(base: UgcModelEndpoint, id: string): UgcModelEndpoint {
  if (id === "kling") {
    return { ...base, falId: envString("FAL_KLING_I2V_MODEL", base.falId) };
  }
  if (id === "seedance") {
    return { ...base, falId: envString("FAL_SEEDANCE_I2V_MODEL", base.falId) };
  }
  if (id === "wan") {
    return { ...base, falId: envString("FAL_WAN_I2V_MODEL", base.falId) };
  }
  return base;
}

/**
 * Ordered still chain from env pin, or a safe default when auto.
 * Prefer `planUgcCreative()` for per-brief selection; this is the fallback / pin path.
 */
export function resolveStillChain(overrideIds?: string[]): UgcModelEndpoint[] {
  const allowed = Object.keys(STILL_MODELS);
  if (overrideIds?.length) {
    const ids = overrideIds.filter((id, i, arr) => allowed.includes(id) && arr.indexOf(id) === i);
    const chain = ids.map((id) => applyStillFalOverrides(STILL_MODELS[id as UgcStillModelId]!, id));
    if (chain.length) return chain;
  }
  const primary = envString("UGC_STILL_MODEL", "auto");
  if (isAutoModelEnv(primary)) {
    return ["nano_banana", "flux_dev", "seedream"]
      .filter((id) => allowed.includes(id))
      .map((id) => applyStillFalOverrides(STILL_MODELS[id as UgcStillModelId]!, id));
  }
  const fallbacks = parseIdList(envString("UGC_STILL_FALLBACKS", "flux_dev,seedream"), allowed);
  const ids = [primary, ...fallbacks].filter((id, i, arr) => allowed.includes(id) && arr.indexOf(id) === i);
  const chain = ids.map((id) => applyStillFalOverrides(STILL_MODELS[id as UgcStillModelId]!, id));
  return chain.length ? chain : [STILL_MODELS.nano_banana];
}

/**
 * Ordered motion chain from env pin, or Kling→Seedance→Wan when auto.
 * Prefer `planUgcCreative()` for per-brief selection.
 */
export function resolveMotionChain(overrideIds?: string[]): UgcModelEndpoint[] {
  const allowed = Object.keys(MOTION_MODELS);
  if (overrideIds?.length) {
    const ids = overrideIds.filter((id, i, arr) => allowed.includes(id) && arr.indexOf(id) === i);
    const chain = ids.map((id) => applyMotionFalOverrides(MOTION_MODELS[id as UgcMotionModelId]!, id));
    if (chain.length) return chain;
  }
  const primary = envString("UGC_MOTION_MODEL", "auto");
  if (isAutoModelEnv(primary)) {
    return ["kling", "seedance", "wan"]
      .filter((id) => allowed.includes(id))
      .map((id) => applyMotionFalOverrides(MOTION_MODELS[id as UgcMotionModelId]!, id));
  }
  const fallbacks = parseIdList(envString("UGC_MOTION_FALLBACKS", "seedance,wan"), allowed);
  const ids = [primary, ...fallbacks].filter((id, i, arr) => allowed.includes(id) && arr.indexOf(id) === i);
  const chain = ids.map((id) => applyMotionFalOverrides(MOTION_MODELS[id as UgcMotionModelId]!, id));
  return chain.length ? chain : [MOTION_MODELS.kling];
}

/**
 * Which families can actually carry client product photos into the generation.
 * Flux Dev on fal is text-to-image only — handing it `image_urls` silently
 * produces a generic product that is NOT the client's.
 */
export function familyAcceptsImageRefs(family: UgcModelEndpoint["family"]): boolean {
  return family === "nano_banana" || family === "seedream";
}

/** fal's named `image_size` vocabulary (flux / seedream) from a "w:h" ratio. */
export function namedImageSize(aspectRatio?: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(aspectRatio ?? "");
  if (!m) return "square_hd";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return "square_hd";
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return "square_hd";
  if (r < 1) return r <= 0.6 ? "portrait_16_9" : "portrait_4_3";
  return r >= 1.6 ? "landscape_16_9" : "landscape_4_3";
}

/** Normalise an LLM-supplied / caller-supplied seconds value to a sane number. */
export function normaliseMotionSeconds(raw: string | number | undefined, fallback = 5): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (n == null || !Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(30, n));
}

/**
 * Snap a duration onto the target family's allowed set.
 * Kling v2.1 standard i2v accepts ONLY "5" or "10" — passing "4" 422s on submit,
 * which silently demoted every job to Seedance and broke the unit economics.
 */
export function clampDurationForFamily(
  family: UgcModelEndpoint["family"],
  raw: string | number | undefined,
): number {
  const sec = normaliseMotionSeconds(raw);
  if (family === "kling") return sec <= 7.5 ? 5 : 10;
  if (family === "seedance") return Math.max(3, Math.min(12, Math.round(sec)));
  return Math.max(1, Math.min(10, Math.round(sec)));
}

/** Wan takes frames, not seconds — keep the requested duration instead of dropping it. */
export function wanFramesForSeconds(raw: string | number | undefined, fps = 16): number {
  const sec = clampDurationForFamily("wan", raw);
  return Math.max(17, Math.min(161, Math.round(sec * fps) + 1));
}

export function buildStillInput(
  family: UgcModelEndpoint["family"],
  opts: { prompt: string; imageUrls?: string[]; aspectRatio?: string; negativePrompt?: string },
): Record<string, unknown> {
  const aspect = opts.aspectRatio ?? "9:16";
  const imageSize = namedImageSize(aspect);
  if (family === "flux") {
    // Text-to-image only: it cannot carry image_urls. falGenerateImageRouted skips
    // this family when product refs are mandatory.
    return {
      prompt: opts.prompt,
      image_size: imageSize,
      num_images: 1,
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  if (family === "seedream") {
    return {
      prompt: opts.prompt,
      image_size: imageSize,
      num_images: 1,
      ...(opts.imageUrls?.length ? { image_urls: opts.imageUrls } : {}),
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  // nano_banana default
  return {
    prompt: opts.prompt,
    aspect_ratio: aspect,
    num_images: 1,
    ...(opts.imageUrls?.length ? { image_urls: opts.imageUrls } : {}),
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };
}

export function buildMotionInput(
  family: UgcModelEndpoint["family"],
  opts: {
    prompt: string;
    startImageUrl: string;
    duration?: string | number;
    aspectRatio?: string;
    negativePrompt?: string;
    generateAudio?: boolean;
  },
): Record<string, unknown> {
  const aspect = opts.aspectRatio ?? "9:16";
  const seconds = clampDurationForFamily(family, opts.duration);
  if (family === "seedance") {
    return {
      prompt: opts.prompt,
      image_url: opts.startImageUrl,
      duration: String(seconds),
      aspect_ratio: aspect,
      camera_fixed: false,
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  if (family === "wan") {
    return {
      prompt: opts.prompt,
      image_url: opts.startImageUrl,
      num_frames: wanFramesForSeconds(opts.duration),
      frames_per_second: 16,
      aspect_ratio: aspect,
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  // kling default — duration MUST be "5" or "10"
  return {
    prompt: opts.prompt,
    start_image_url: opts.startImageUrl,
    duration: String(seconds),
    generate_audio: opts.generateAudio ?? false,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };
}
