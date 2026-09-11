import { getServerEnv } from "@pulse/shared";

/**
 * Phase C9 — model router.
 * Photo restyle/generate → Flux (Replicate). Designed text slides → Satori composer.
 * Ideogram / Recraft only when env models are set (specialty posters / illustrations).
 */

export type ImageJob =
  | "photo_edit"
  | "photo_generate"
  | "designed_slide"
  | "specialty_poster"
  | "specialty_illustration";

export type ImageEngine = "flux" | "composer" | "ideogram" | "recraft";

export type RouteDecision = {
  engine: ImageEngine;
  /** Replicate model slug when engine hits Replicate; undefined for composer. */
  model?: string;
  reason: string;
};

type EnvLike = {
  REPLICATE_IMAGE_MODEL?: string;
  REPLICATE_TEXT_IMAGE_MODEL?: string;
  REPLICATE_IDEOGRAM_MODEL?: string;
  REPLICATE_RECRAFT_MODEL?: string;
};

function envModels(): EnvLike {
  try {
    const e = getServerEnv();
    return {
      REPLICATE_IMAGE_MODEL: e.REPLICATE_IMAGE_MODEL,
      REPLICATE_TEXT_IMAGE_MODEL: e.REPLICATE_TEXT_IMAGE_MODEL,
      REPLICATE_IDEOGRAM_MODEL: e.REPLICATE_IDEOGRAM_MODEL,
      REPLICATE_RECRAFT_MODEL: e.REPLICATE_RECRAFT_MODEL,
    };
  } catch {
    return {
      REPLICATE_IMAGE_MODEL: process.env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-kontext-pro",
      REPLICATE_TEXT_IMAGE_MODEL:
        process.env.REPLICATE_TEXT_IMAGE_MODEL || "black-forest-labs/flux-schnell",
      REPLICATE_IDEOGRAM_MODEL: process.env.REPLICATE_IDEOGRAM_MODEL || undefined,
      REPLICATE_RECRAFT_MODEL: process.env.REPLICATE_RECRAFT_MODEL || undefined,
    };
  }
}

/** Pick the rendering engine for a creative job. */
export function routeImageJob(job: ImageJob): RouteDecision {
  const env = envModels();

  switch (job) {
    case "photo_edit":
      return {
        engine: "flux",
        model: env.REPLICATE_IMAGE_MODEL,
        reason: "Photoreal restyle uses Flux Kontext",
      };
    case "photo_generate":
      return {
        engine: "flux",
        model: env.REPLICATE_TEXT_IMAGE_MODEL,
        reason: "Photo-style text-to-image uses Flux",
      };
    case "designed_slide":
      return {
        engine: "composer",
        reason: "Multi-line type stays in the Satori design composer for legibility",
      };
    case "specialty_poster":
      if (env.REPLICATE_IDEOGRAM_MODEL) {
        return {
          engine: "ideogram",
          model: env.REPLICATE_IDEOGRAM_MODEL,
          reason: "Ideogram enabled for full-bleed poster type-in-raster",
        };
      }
      return {
        engine: "composer",
        reason: "Ideogram unset — fall back to design composer",
      };
    case "specialty_illustration":
      if (env.REPLICATE_RECRAFT_MODEL) {
        return {
          engine: "recraft",
          model: env.REPLICATE_RECRAFT_MODEL,
          reason: "Recraft enabled for brand illustration",
        };
      }
      return {
        engine: "composer",
        reason: "Recraft unset — fall back to design composer",
      };
    default: {
      const _exhaustive: never = job;
      return { engine: "composer", reason: `Unknown job ${_exhaustive}` };
    }
  }
}

/**
 * Optional specialty Replicate call. Returns null when the model flag is off or
 * the request fails — callers should fall back to the design composer.
 */
export async function specialtyReplicateGenerate(
  engine: "ideogram" | "recraft",
  prompt: string,
  aspectRatio = "1:1",
): Promise<Buffer | null> {
  const decision =
    engine === "ideogram" ? routeImageJob("specialty_poster") : routeImageJob("specialty_illustration");
  if (decision.engine !== engine || !decision.model) return null;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;

  try {
    let body: { status?: string; output?: unknown; urls?: { get?: string }; retry_after?: number };
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.replicate.com/v1/models/${decision.model}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: { prompt, aspect_ratio: aspectRatio, output_format: "jpg" },
        }),
      });
      body = (await res.json()) as typeof body;
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, ((body.retry_after ?? 3) + 2) * 1000));
        continue;
      }
      if (!res.ok) return null;
      break;
    }
    const getUrl = body!.urls?.get;
    for (let i = 0; i < 30 && body!.status && body!.status !== "succeeded"; i++) {
      if (body!.status === "failed" || body!.status === "canceled") return null;
      await new Promise((r) => setTimeout(r, 2000));
      if (!getUrl) break;
      body = (await (await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } })).json()) as typeof body;
    }
    let out = body!.output;
    if (Array.isArray(out)) out = out[0];
    if (typeof out !== "string") return null;
    return Buffer.from(await (await fetch(out)).arrayBuffer());
  } catch (err) {
    console.error(`specialtyReplicateGenerate(${engine}) failed`, err);
    return null;
  }
}
