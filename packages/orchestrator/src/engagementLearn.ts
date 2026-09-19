import { query, type Brand, type EngagementProfile } from "@pulse/shared";
import { readEngagementProfile } from "./engagementProfile.js";

/**
 * Phase 3 — the learning loop. Kip nudges each owner's proactivity dial from
 * how they actually respond, so the dial earns its setting instead of guessing.
 *
 * Conservative by policy (getting this wrong means texting a paying customer
 * too much → muted number → churn):
 *  - default everyone balanced; only move on sustained signal.
 *  - DOWN fast (needs >=2 channels clearly disliked), UP slow (needs real
 *    enthusiasm) and capped at balanced — the learner NEVER escalates to high.
 *  - an owner's explicit setting (source='owner_set') is a hard floor/ceiling
 *    the learner won't cross.
 *  - at most one dial-step per run — no whiplash.
 *
 * Rolled out behind KIP_ENGAGEMENT_LEARN, log-only first (compute + log the
 * intended change without writing), then 'on' to apply.
 */

const EMA_ALPHA = 0.3; // weight on the new signal; 0.7 on history
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // a reply within 24h = engaged
const JUDGE_AFTER_MS = 48 * 60 * 60 * 1000; // don't score a send until 48h passed
const DISLIKE_THRESHOLD = -0.3; // per-channel affinity below this = disliked
const DISLIKE_CHANNELS_FOR_DOWN = 2; // need this many disliked channels to step down
const ENTHUSIASM_THRESHOLD = 0.4; // mean affinity above this = step up (to balanced)

export interface ProactiveSendRow {
  channel: string;
  sent_at: string;
}

/** Per-channel signal in [-1, 1] from judgeable sends vs. subsequent replies. Pure. */
export function computeChannelSignals(
  sends: ProactiveSendRow[],
  inboundTimes: number[],
  now: Date,
  opts: { replyWindowMs?: number; judgeAfterMs?: number } = {},
): Record<string, number> {
  const replyWindowMs = opts.replyWindowMs ?? REPLY_WINDOW_MS;
  const judgeAfterMs = opts.judgeAfterMs ?? JUDGE_AFTER_MS;
  const nowMs = now.getTime();
  const sorted = [...inboundTimes].sort((a, b) => a - b);
  const perChannel = new Map<string, number[]>();
  for (const s of sends) {
    const sentMs = new Date(s.sent_at).getTime();
    if (Number.isNaN(sentMs)) continue;
    if (nowMs - sentMs < judgeAfterMs) continue; // too fresh to judge
    const replied = sorted.some((t) => t > sentMs && t <= sentMs + replyWindowMs);
    const list = perChannel.get(s.channel) ?? [];
    list.push(replied ? 1 : -1);
    perChannel.set(s.channel, list);
  }
  const signals: Record<string, number> = {};
  for (const [channel, arr] of perChannel) {
    signals[channel] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return signals;
}

/** Exponential moving average of per-channel affinity. Pure. */
export function updateAffinity(
  prev: Record<string, number>,
  signals: Record<string, number>,
): Record<string, number> {
  const next: Record<string, number> = { ...prev };
  for (const [channel, signal] of Object.entries(signals)) {
    const old = typeof prev[channel] === "number" ? prev[channel]! : 0;
    const ema = (1 - EMA_ALPHA) * old + EMA_ALPHA * signal;
    // Clamp to [-1, 1] against float drift.
    next[channel] = Math.max(-1, Math.min(1, ema));
  }
  return next;
}

const PROACTIVITY_LADDER: EngagementProfile["proactivity"][] = ["quiet", "balanced", "high"];

/**
 * Decide the single dial step (or none) implied by the affinity map. Pure.
 * Returns the new proactivity level, or null to leave the dial alone.
 */
export function decideDialChange(
  profile: EngagementProfile,
  affinity: Record<string, number>,
): EngagementProfile["proactivity"] | null {
  // Owner's explicit choice is a hard boundary — never override it.
  if (profile.source === "owner_set") return null;
  const values = Object.values(affinity);
  if (values.length === 0) return null;
  const idx = PROACTIVITY_LADDER.indexOf(profile.proactivity);
  const dislikedChannels = values.filter((v) => v < DISLIKE_THRESHOLD).length;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  // DOWN: sustained dislike across channels, step down one notch.
  if (dislikedChannels >= DISLIKE_CHANNELS_FOR_DOWN && idx > 0) {
    return PROACTIVITY_LADDER[idx - 1]!;
  }
  // UP: real enthusiasm, step up one notch — but the learner caps at balanced.
  if (mean > ENTHUSIASM_THRESHOLD && idx < PROACTIVITY_LADDER.indexOf("balanced")) {
    return PROACTIVITY_LADDER[idx + 1]!;
  }
  return null;
}

export interface LearnPlan {
  nextAffinity: Record<string, number>;
  /** New proactivity level, or null when the dial stays put. */
  dialChange: EngagementProfile["proactivity"] | null;
  reason: string;
}

/** Combine signals → affinity → dial decision into a plan. Pure. */
export function planEngagementLearn(
  profile: EngagementProfile,
  sends: ProactiveSendRow[],
  inboundTimes: number[],
  now: Date,
  opts?: { replyWindowMs?: number; judgeAfterMs?: number },
): LearnPlan {
  const signals = computeChannelSignals(sends, inboundTimes, now, opts ?? {});
  const nextAffinity = updateAffinity(profile.affinity, signals);
  const dialChange = decideDialChange({ ...profile, affinity: nextAffinity }, nextAffinity);
  const reason = dialChange
    ? `proactivity ${profile.proactivity} -> ${dialChange} (affinity ${JSON.stringify(nextAffinity)})`
    : `no dial change (affinity ${JSON.stringify(nextAffinity)})`;
  return { nextAffinity, dialChange, reason };
}

// ─── IO: gather inputs and (optionally) persist ─────────────────────────

const LOOKBACK_DAYS = 30;

export async function fetchLearnInputs(
  brandId: string,
): Promise<{ sends: ProactiveSendRow[]; inboundTimes: number[] }> {
  const sends = await query<ProactiveSendRow>(
    `select channel, sent_at from proactive_sends
      where brand_id = $1 and sent_at > now() - ($2::text || ' days')::interval`,
    [brandId, String(LOOKBACK_DAYS)],
  );
  const inbound = await query<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and direction = 'inbound'
        and created_at > now() - ($2::text || ' days')::interval`,
    [brandId, String(LOOKBACK_DAYS)],
  );
  return {
    sends,
    inboundTimes: inbound.map((r) => new Date(r.created_at).getTime()).filter((n) => !Number.isNaN(n)),
  };
}

async function persistLearn(brandId: string, profile: EngagementProfile, plan: LearnPlan): Promise<void> {
  const next: EngagementProfile = {
    ...profile,
    affinity: plan.nextAffinity,
    updated_at: new Date().toISOString(),
  };
  if (plan.dialChange) {
    next.proactivity = plan.dialChange;
    next.source = "learned";
  }
  await query(
    `update brands
        set facts = jsonb_set(coalesce(facts, '{}'::jsonb), '{engagement_profile}', $2::jsonb, true)
      where id = $1`,
    [brandId, JSON.stringify(next)],
  );
}

/**
 * Learn for one brand. Returns the plan (for logging). Writes only when
 * `apply` is true — log-only mode computes and returns without persisting.
 */
export async function learnEngagementForBrand(
  brand: Brand,
  opts: { apply: boolean; now?: Date } = { apply: false },
): Promise<LearnPlan> {
  const now = opts.now ?? new Date();
  const profile = readEngagementProfile(brand);
  const { sends, inboundTimes } = await fetchLearnInputs(brand.id);
  const plan = planEngagementLearn(profile, sends, inboundTimes, now);
  if (opts.apply) await persistLearn(brand.id, profile, plan);
  return plan;
}
