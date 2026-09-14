import { getServerEnv } from "@pulse/shared";
import {
  resolveStillChain,
  resolveMotionChain,
  buildStillInput,
  buildMotionInput,
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
  });
  const submitted = (await res.json()) as FalQueueSubmit;
  if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(submitted).slice(0, 200)}`);

  let statusUrl = submitted.status_url;
  let responseUrl = submitted.response_url;

  for (let i = 0; i < 90; i++) {
    if (responseUrl) {
      const done = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
      if (done.ok) {
        const payload = (await done.json()) as T;
        const url = pickUrl(payload);
        if (url) return Buffer.from(await (await fetch(url)).arrayBuffer());
      }
    }
    if (!statusUrl) break;
    await new Promise((r) => setTimeout(r, 3000));
    const st = (await (
      await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } })
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
}): Promise<RoutedResult | null> {
  const chain = resolveStillChain();
  const errors: string[] = [];
  for (const endpoint of chain) {
    try {
      const input = buildStillInput(endpoint.family, opts);
      const buffer = await falQueue(endpoint.falId, input, pickImageUrl);
      if (buffer) {
        return { buffer, modelId: endpoint.id, falId: endpoint.falId, label: endpoint.label };
      }
      errors.push(`${endpoint.id}: empty`);
    } catch (err) {
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
  negativePrompt?: string;
  generateAudio?: boolean;
}): Promise<RoutedResult | null> {
  const chain = resolveMotionChain();
  const errors: string[] = [];
  for (const endpoint of chain) {
    try {
      const input = buildMotionInput(endpoint.family, opts);
      const buffer = await falQueue(endpoint.falId, input, pickVideoUrl);
      if (buffer) {
        return { buffer, modelId: endpoint.id, falId: endpoint.falId, label: endpoint.label };
      }
      errors.push(`${endpoint.id}: empty`);
    } catch (err) {
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

export function describeUgcModelChains(): {
  still: Array<{ id: string; falId: string; label: string }>;
  motion: Array<{ id: string; falId: string; label: string }>;
} {
  return {
    still: resolveStillChain().map(({ id, falId, label }) => ({ id, falId, label })),
    motion: resolveMotionChain().map(({ id, falId, label }) => ({ id, falId, label })),
  };
}
