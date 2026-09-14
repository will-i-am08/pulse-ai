import { getServerEnv } from "@pulse/shared";
import {
  resolveStillChain,
  resolveMotionChain,
  buildStillInput,
  buildMotionInput,
  familyAcceptsImageRefs,
  type UgcModelEndpoint,
} from "./modelRouter.js";

type StillOverride = Pick<UgcModelEndpoint, "id" | "label" | "falId" | "family">;

/**
 * fal.ai transport for UGC — model choice comes from modelRouter (Nano Banana,
 * Flux, Seedream / Kling, Seedance, Wan), not hard-coded to one vendor model.
 */

function falKey(): string | undefined {
  return (
    process.env.FAL_KEY ??
    (() => {
      try {
        return getServerEnv().FAL_KEY;
      } catch {
        return undefined;
      }
    })()
  );
}

export function falConfigured(): boolean {
  return Boolean(falKey());
}

type FalQueueSubmit = {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  error?: string;
};

/** Control-plane calls (submit/status/result) — short, bounded. */
export const FAL_CONTROL_TIMEOUT_MS = 30_000;
/** CDN asset download — generous (a 10s 1080p mp4 is tens of MB). */
export const FAL_ASSET_TIMEOUT_MS = 120_000;

/**
 * Download a finished asset. A transient network failure here is NOT a model
 * failure — we have already paid for these bytes — so retry before giving up
 * rather than letting the caller submit the next (billable) model.
 */
async function downloadAsset(url: string): Promise<Buffer> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FAL_ASSET_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`asset ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new FalAssetDownloadError(
    `fal asset download failed after 3 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Raised when generation SUCCEEDED but fetching the bytes did not. Callers must
 * not treat this as "try the next model" — the generation is already billed.
 */
export class FalAssetDownloadError extends Error {
  readonly paidFor = true;
  constructor(message: string) {
    super(message);
    this.name = "FalAssetDownloadError";
  }
}

export async function falQueue<T extends Record<string, unknown>>(
  model: string,
  input: Record<string, unknown>,
  pickUrl: (payload: T) => string | undefined,
): Promise<Buffer | null> {
  const key = falKey();
  if (!key) return null;

  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(FAL_CONTROL_TIMEOUT_MS),
  });
  const submitted = (await res.json()) as FalQueueSubmit;
  if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(submitted).slice(0, 200)}`);

  let statusUrl = submitted.status_url;
  let responseUrl = submitted.response_url;

  for (let i = 0; i < 90; i++) {
    if (responseUrl) {
      const done = await fetch(responseUrl, {
        headers: { Authorization: `Key ${key}` },
        signal: AbortSignal.timeout(FAL_CONTROL_TIMEOUT_MS),
      });
      if (done.ok) {
        const payload = (await done.json()) as T;
        const url = pickUrl(payload);
        if (url) return await downloadAsset(url);
      }
    }
    if (!statusUrl) break;
    await new Promise((r) => setTimeout(r, 3000));
    const st = (await (
      await fetch(statusUrl, {
        headers: { Authorization: `Key ${key}` },
        signal: AbortSignal.timeout(FAL_CONTROL_TIMEOUT_MS),
      })
    ).json()) as { status?: string; response_url?: string; status_url?: string };
    if (st.response_url) responseUrl = st.response_url;
    if (st.status_url) statusUrl = st.status_url;
    if (st.status === "FAILED" || st.status === "failed") throw new Error(`fal failed: ${model}`);
  }
  return null;
}

function pickImageUrl(p: {
  images?: Array<{ url?: string }>;
  image?: { url?: string };
}): string | undefined {
  return p.images?.[0]?.url ?? p.image?.url;
}

function pickVideoUrl(p: { video?: { url?: string }; video_url?: string }): string | undefined {
  return p.video?.url ?? p.video_url;
}

export type RoutedResult = {
  buffer: Buffer;
  modelId: string;
  falId: string;
  label: string;
};

/** Try still chain until one model returns bytes. */
export async function falGenerateImageRouted(opts: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  negativePrompt?: string;
  /**
   * When true, a model family that cannot accept `imageUrls` is SKIPPED rather
   * than silently generating a generic product that isn't the client's.
   */
  requireImageRefs?: boolean;
  /** Called immediately before each billable fal submission (spend accounting). */
  onSubmission?: (falId: string) => void;
  /** Optional pre-planned chain (from planUgcCreative); else env/auto default */
  chain?: UgcModelEndpoint[];
}): Promise<RoutedResult | null> {
  const chain = opts.chain?.length ? opts.chain : resolveStillChain();
  const errors: string[] = [];
  for (const endpoint of chain) {
    if (opts.requireImageRefs && opts.imageUrls?.length && !familyAcceptsImageRefs(endpoint.family)) {
      errors.push(`${endpoint.id}: skipped (cannot carry product refs)`);
      continue;
    }
    try {
      const input = buildStillInput(endpoint.family, opts);
      opts.onSubmission?.(endpoint.falId);
      const buffer = await falQueue(endpoint.falId, input, pickImageUrl);
      if (buffer) {
        return { buffer, modelId: endpoint.id, falId: endpoint.falId, label: endpoint.label };
      }
      errors.push(`${endpoint.id}: empty`);
    } catch (err) {
      // Already paid for these bytes — do not submit the next model.
      if (err instanceof FalAssetDownloadError) throw err;
      errors.push(`${endpoint.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length) {
    console.warn(JSON.stringify({ evt: "ugc_still_router_miss", errors }));
  }
  return null;
}

/** Try motion chain until one model returns bytes. */
export async function falImageToVideoRouted(opts: {
  prompt: string;
  startImageUrl: string;
  duration?: string | number;
  aspectRatio?: string;
  negativePrompt?: string;
  generateAudio?: boolean;
  /** Called immediately before each billable fal submission (spend accounting). */
  onSubmission?: (falId: string) => void;
  /** Optional pre-planned chain (from planUgcCreative); else env/auto default */
  chain?: UgcModelEndpoint[];
}): Promise<RoutedResult | null> {
  const chain = opts.chain?.length ? opts.chain : resolveMotionChain();
  const errors: string[] = [];
  for (const endpoint of chain) {
    try {
      const input = buildMotionInput(endpoint.family, opts);
      opts.onSubmission?.(endpoint.falId);
      const buffer = await falQueue(endpoint.falId, input, pickVideoUrl);
      if (buffer) {
        return { buffer, modelId: endpoint.id, falId: endpoint.falId, label: endpoint.label };
      }
      errors.push(`${endpoint.id}: empty`);
    } catch (err) {
      // Already paid for these bytes — do not submit the next model.
      if (err instanceof FalAssetDownloadError) throw err;
      errors.push(`${endpoint.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length) {
    console.warn(JSON.stringify({ evt: "ugc_motion_router_miss", errors }));
  }
  return null;
}

/** @deprecated prefer falGenerateImageRouted — kept for single-model callers */
export async function falGenerateImage(opts: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  negativePrompt?: string;
  /** Optional explicit fal model override */
  model?: string;
}): Promise<Buffer | null> {
  if (opts.model) {
    const endpoint: StillOverride = {
      id: "override",
      label: opts.model,
      falId: opts.model,
      family: "nano_banana",
    };
    const input = buildStillInput(endpoint.family, opts);
    return falQueue(endpoint.falId, input, pickImageUrl);
  }
  const routed = await falGenerateImageRouted(opts);
  return routed?.buffer ?? null;
}

/** @deprecated prefer falImageToVideoRouted */
export async function falImageToVideo(opts: {
  prompt: string;
  startImageUrl: string;
  duration?: string | number;
  negativePrompt?: string;
  generateAudio?: boolean;
  model?: string;
}): Promise<Buffer | null> {
  if (opts.model) {
    return falQueue(opts.model, buildMotionInput("kling", opts), pickVideoUrl);
  }
  const routed = await falImageToVideoRouted(opts);
  return routed?.buffer ?? null;
}

export function describeUgcModelChains(plan?: {
  still: UgcModelEndpoint[];
  motion: UgcModelEndpoint[];
}): {
  still: Array<{ id: string; falId: string; label: string }>;
  motion: Array<{ id: string; falId: string; label: string }>;
} {
  const still = plan?.still?.length ? plan.still : resolveStillChain();
  const motion = plan?.motion?.length ? plan.motion : resolveMotionChain();
  return {
    still: still.map(({ id, falId, label }) => ({ id, falId, label })),
    motion: motion.map(({ id, falId, label }) => ({ id, falId, label })),
  };
}
