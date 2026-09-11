import { getServerEnv, resetServerEnvCache } from "@pulse/shared";

export type CostKind = "image" | "video" | "specialty";

const DEFAULTS: Record<CostKind, number> = {
  image: 0.04,
  video: 0.5,
  specialty: 0.12,
};

function readUsd(kind: CostKind): number {
  try {
    const e = getServerEnv();
    if (kind === "image") return e.COST_IMAGE_USD;
    if (kind === "video") return e.COST_VIDEO_USD;
    return e.COST_SPECIALTY_USD;
  } catch {
    const envKey =
      kind === "image"
        ? "COST_IMAGE_USD"
        : kind === "video"
          ? "COST_VIDEO_USD"
          : "COST_SPECIALTY_USD";
    const raw = process.env[envKey];
    const n = raw != null && raw !== "" ? Number(raw) : DEFAULTS[kind];
    return Number.isFinite(n) && n >= 0 ? n : DEFAULTS[kind];
  }
}

/** USD estimate for an AI generation job (env COST_*_USD with defaults). */
export function estimateCost(opts: { kind: CostKind }): { kind: CostKind; usd: number } {
  return { kind: opts.kind, usd: readUsd(opts.kind) };
}

/** Format a short dollar string for SMS (~$0.50 / ~$1). */
export function formatCostUsd(usd: number): string {
  if (usd >= 1) return `~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)}`;
  if (usd >= 0.1) return `~$${usd.toFixed(2)}`;
  return `~$${usd.toFixed(2)}`;
}

/** Owner-facing SMS clause when kicking off a billable AI job. */
export function costEstimateSmsLine(kind: CostKind): string {
  const { usd } = estimateCost({ kind });
  return `(this may cost ${formatCostUsd(usd)})`;
}

/** Weekly AI spend cap in USD (env AI_WEEKLY_SPEND_CAP_USD, default 10). */
export function weeklyAiSpendCapUsd(): number {
  try {
    return getServerEnv().AI_WEEKLY_SPEND_CAP_USD;
  } catch {
    const n = Number(process.env.AI_WEEKLY_SPEND_CAP_USD ?? 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }
}

/** Test helper — re-export reset so cost tests can mutate env. */
export { resetServerEnvCache };
