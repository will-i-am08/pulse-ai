/** Content-job layer (Jake-style) on top of pillars — Proof / Teach / Opinion / Story / Offer. */

import type { PostFormat } from "@pulse/shared";

export const CONTENT_JOBS = ["proof", "teach", "opinion", "story", "offer"] as const;
export type ContentJob = (typeof CONTENT_JOBS)[number];

/** Weekly cadence doctrine — not pillar quotas. Offer stays sparse. */
export const DEFAULT_JOB_MIX: Record<ContentJob, { per_week: number; note: string }> = {
  proof: { per_week: 1, note: "1×/week — results, receipts, before/after" },
  teach: { per_week: 1.5, note: "1–2×/week — how-to, mistakes, frameworks" },
  opinion: { per_week: 1, note: "1×/week — a stance that could lose followers" },
  story: { per_week: 0.5, note: "1×/fortnight — lived moment, client win, behind the curtain" },
  offer: { per_week: 0.5, note: "1×/fortnight — soft sell, Stories/carousel-led" },
};

const PILLAR_JOB_HINTS: Array<{ re: RegExp; job: ContentJob }> = [
  { re: /\b(proof|testimonial|result|review|case.?study|social.?proof|win)\b/i, job: "proof" },
  { re: /\b(educat|teach|tip|how.?to|guide|myth|mistake|framework|explainer)\b/i, job: "teach" },
  { re: /\b(opinion\w*|hot.?take|rant|belief|position|contrarian|stand)\b/i, job: "opinion" },
  { re: /\b(story|behind|bts|day.?in|diary|founder|journey|moment)\b/i, job: "story" },
  { re: /\b(offer|promo|cta|book|buy|launch|sale|product|service|menu)\b/i, job: "offer" },
  { re: /\b(product|lifestyle)\b/i, job: "story" },
];

/** Map a pillar key/name/description to a content job. */
export function inferContentJob(input: {
  key?: string | null;
  name?: string | null;
  description?: string | null;
  content_job?: string | null;
}): ContentJob {
  const explicit = String(input.content_job ?? "").toLowerCase().trim();
  if ((CONTENT_JOBS as readonly string[]).includes(explicit)) return explicit as ContentJob;
  const blob = `${input.key ?? ""} ${input.name ?? ""} ${input.description ?? ""}`;
  for (const h of PILLAR_JOB_HINTS) {
    if (h.re.test(blob)) return h.job;
  }
  return "teach";
}

/**
 * True when the brief/destinations are LinkedIn-first (no IG/TikTok/FB co-target).
 * LinkedIn has no Stories/Reels — callers must not apply IG discovery bias.
 */
export function isLinkedInPrimary(
  destinations?: ReadonlyArray<string> | null,
): boolean {
  const dests = (destinations ?? []).map((d) => String(d).toLowerCase());
  if (!dests.includes("linkedin")) return false;
  const igFamily = dests.some((d) => d === "instagram" || d === "tiktok" || d === "facebook");
  if (igFamily) return false;
  return dests[0] === "linkedin" || dests.every((d) => d === "linkedin" || d === "x" || d === "threads");
}

/**
 * Format bias by job + goal.
 * Discovery / non-follower reach → Reels. Depth / saves / offer → carousel. Story job → story-friendly.
 * LinkedIn-primary briefs never get story/reel — feed or carousel only.
 */
export function formatBiasForJob(
  job: ContentJob,
  opts?: { needDiscovery?: boolean; destinations?: ReadonlyArray<string> | null },
): PostFormat {
  if (isLinkedInPrimary(opts?.destinations)) {
    switch (job) {
      case "offer":
      case "teach":
      case "proof":
        return "carousel";
      case "opinion":
      case "story":
      default:
        return "feed";
    }
  }
  const discovery = opts?.needDiscovery !== false;
  switch (job) {
    case "proof":
    case "opinion":
      return discovery ? "reel" : "carousel";
    case "teach":
      return discovery ? "reel" : "carousel";
    case "story":
      return discovery ? "reel" : "story";
    case "offer":
      return "carousel";
    default:
      return "carousel";
  }
}

/** Prompt block: job mix doctrine for niche-plan / filler / caption LLMs (local, no I/O). */
export function jobMixPromptBlock(): string {
  return [
    "Content jobs (tag each pillar with one; ratios matter more than portfolio labels):",
    ...CONTENT_JOBS.map((j) => `- ${j}: ${DEFAULT_JOB_MIX[j].note}`),
    "Opinion + Story are usually underrepresented — include them.",
    "Offer is sparse and soft; prefer Stories or carousels for Offer, not hard-sell Reels every week.",
    "Format doctrine by goal: Reels for non-follower discovery/reach; carousels for teach/offer depth and saves; Stories for daily sell + question harvest. Do NOT default every niche to carousel-heavy.",
  ].join("\n");
}

/** Pick the job that is furthest under its weekly target given recent job tags. */
export function pickUnderrepresentedJob(recentJobs: ContentJob[]): ContentJob {
  const counts: Record<ContentJob, number> = {
    proof: 0,
    teach: 0,
    opinion: 0,
    story: 0,
    offer: 0,
  };
  for (const j of recentJobs) counts[j] = (counts[j] ?? 0) + 1;
  // Window ≈ one week of posts; compare to targets.
  let best: ContentJob = "teach";
  let bestGap = -Infinity;
  for (const j of CONTENT_JOBS) {
    const gap = DEFAULT_JOB_MIX[j].per_week - (counts[j] ?? 0);
    // Prefer filling opinion/story gaps when tied.
    const tie = j === "opinion" || j === "story" ? 0.1 : 0;
    if (gap + tie > bestGap) {
      bestGap = gap + tie;
      best = j;
    }
  }
  return best;
}

export function isContentJob(v: unknown): v is ContentJob {
  return typeof v === "string" && (CONTENT_JOBS as readonly string[]).includes(v);
}
