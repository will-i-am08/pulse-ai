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

export function buildStillInput(
  family: UgcModelEndpoint["family"],
  opts: { prompt: string; imageUrls?: string[]; aspectRatio?: string; negativePrompt?: string },
): Record<string, unknown> {
  const aspect = opts.aspectRatio ?? "9:16";
  if (family === "flux") {
    return {
      prompt: opts.prompt,
      image_size: "portrait_16_9", // closest; fal flux uses named sizes
      num_images: 1,
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  if (family === "seedream") {
    return {
      prompt: opts.prompt,
      image_size: "portrait_16_9",
      num_images: 1,
      ...(opts.imageUrls?.length ? { image_urls: opts.imageUrls } : {}),
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
    negativePrompt?: string;
    generateAudio?: boolean;
  },
): Record<string, unknown> {
  const duration = opts.duration ?? "5";
  if (family === "seedance") {
    return {
      prompt: opts.prompt,
      image_url: opts.startImageUrl,
      duration: typeof duration === "string" ? duration : String(duration),
      aspect_ratio: "9:16",
      camera_fixed: false,
    };
  }
  if (family === "wan") {
    return {
      prompt: opts.prompt,
      image_url: opts.startImageUrl,
      num_frames: 81,
      frames_per_second: 16,
      aspect_ratio: "9:16",
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    };
  }
  // kling default
  return {
    prompt: opts.prompt,
    start_image_url: opts.startImageUrl,
    duration,
    generate_audio: opts.generateAudio ?? false,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };
}
