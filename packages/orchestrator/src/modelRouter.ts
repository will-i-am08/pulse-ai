import { getServerEnv } from "@pulse/shared";
import { costEstimateSmsLine } from "./costEstimate.js";
import { assertAiSpendAllowed, recordAiSpend } from "./aiSpend.js";
import { pickStillIds } from "./ugc/creativePlan.js";
import { resolveStillChain } from "./ugc/modelRouter.js";

/**
 * Phase C9 — model router.
 * Photo edit → Flux Kontext (Replicate). Photo generate is logged here as Flux;
 * generatePhotoImage prefers the fal still chain first, then Replicate Flux Schnell.
 * Designed text slides → Satori composer. Ideogram / Recraft when env models are set.
 */

/** Feed / still quality tier for fal chain selection. */
export type CreativeQuality = "draft" | "standard" | "premium";

/**
 * Ordered still model ids for a quality tier.
 * draft → cheaper/faster first; standard → resolveStillChain defaults; premium → brief-aware pick.
 */
export function stillChainForQuality(quality: CreativeQuality, brief?: string): string[] {
  if (quality === "draft") {
    return ["flux_dev", "seedream", "nano_banana"];
  }
  if (quality === "premium") {
    return pickStillIds({
      brief: brief ?? "cinematic premium editorial",
      hasProductRefs: false,
    }).ids;
  }
  return resolveStillChain().map((e) => e.id);
}

/** Route a feed photo job to a quality tier (reason for logs / SMS). */
export function routeFeedPhoto(quality: CreativeQuality): { quality: CreativeQuality; reason: string } {
  switch (quality) {
    case "draft":
      return {
        quality: "draft",
        reason: "Draft tier → Flux Dev / Seedream first (faster, cheaper stills)",
      };
    case "premium":
      return {
        quality: "premium",
        reason: "Premium tier → brief-aware still pick (cinematic / editorial bias)",
      };
    case "standard":
    default:
      return {
        quality: "standard",
        reason: "Standard tier → default fal still chain (Nano Banana → Flux → Seedream)",
      };
  }
}

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
        reason: "Feed T2I prefers fal still router; Replicate Flux is fallback",
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
 * When brandId is passed, respects weekly AI spend cap and records estimated cost.
 */
export async function specialtyReplicateGenerate(
  engine: "ideogram" | "recraft",
  prompt: string,
  aspectRatio = "1:1",
  opts?: { brandId?: string; brandFacts?: { ai_spend?: { week_key: string; spent_usd: number } } },
): Promise<Buffer | null> {
  const decision =
    engine === "ideogram" ? routeImageJob("specialty_poster") : routeImageJob("specialty_illustration");
  if (decision.engine !== engine || !decision.model) return null;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;

  if (opts?.brandId && opts.brandFacts) {
    const blocked = assertAiSpendAllowed({ facts: opts.brandFacts }, "specialty");
    if (blocked) return null;
  }

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
    const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
    if (opts?.brandId) {
      await recordAiSpend(opts.brandId, "specialty").catch(() => {});
    }
    return buf;
  } catch (err) {
    console.error(`specialtyReplicateGenerate(${engine}) failed`, err);
    return null;
  }
}

/** SMS clause for specialty image jobs (Ideogram / Recraft). */
export function specialtyCostSmsHint(): string {
  return costEstimateSmsLine("specialty");
}
