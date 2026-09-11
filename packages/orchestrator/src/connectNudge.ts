import { query, queryOne, type Brand, type OnboardingState } from "@pulse/shared";
import { connectLinkMessage, isMetaConnected } from "./smsConnect.js";
import { ownerFirstName } from "./persona.js";

const FIRST_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;
const NEXT_NUDGE_AFTER_MS = 72 * 60 * 60 * 1000;
const MAX_NUDGES = 4;

export type ConnectNudgeCandidate = {
  brand: Brand;
  message: string;
};

function answersOf(brand: Brand): Record<string, string> {
  return { ...(brand.onboarding_state?.answers ?? {}) };
}

function skippedAtMs(brand: Brand): number | null {
  const answers = answersOf(brand);
  const raw = answers.skipped_connect_at || brand.onboarding_state?.completed_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Brands that skipped Meta connect and are due for another nudge. */
export async function brandsDueForConnectNudge(now: Date = new Date()): Promise<ConnectNudgeCandidate[]> {
  const rows = await query<Brand>(
    `select * from brands
      where coalesce(onboarding_state->'answers'->>'skipped_connect', '') = '1'
        and coalesce(ig_user_id, '') = ''
      order by created_at asc
      limit 20`,
  );

  const due: ConnectNudgeCandidate[] = [];
  for (const brand of rows) {
    if (isMetaConnected(brand)) continue;
    const answers = answersOf(brand);
    const count = Math.max(0, Number(answers.connect_nudge_count ?? "0") || 0);
    if (count >= MAX_NUDGES) continue;

    const skippedAt = skippedAtMs(brand);
    if (skippedAt == null) continue;

    const lastNudge = answers.connect_nudge_at ? Date.parse(answers.connect_nudge_at) : NaN;
    if (count === 0) {
      if (now.getTime() - skippedAt < FIRST_NUDGE_AFTER_MS) continue;
    } else if (!Number.isFinite(lastNudge) || now.getTime() - lastNudge < NEXT_NUDGE_AFTER_MS) {
      continue;
    }

    due.push({ brand, message: connectNudgeMessage(brand, count) });
  }
  return due;
}

export function connectNudgeMessage(brand: Brand, priorCount: number): string {
  const name = ownerFirstName(brand);
  const hi = name ? `${name}, ` : "";
  const link = connectLinkMessage(brand, "meta");
  if (priorCount <= 0) {
    return (
      `${hi}whenever you're ready, connecting Instagram + Facebook lets me learn from what you already post and publish for you. `
      + `No rush — tap when it suits, or keep going with photos over text for now.

${link}`
    );
  }
  if (priorCount === 1) {
    return (
      `${hi}quick nudge — linking IG + Facebook means I can match your real voice and post for you. `
      + `Tap when you're free:

${link}`
    );
  }
  return (
    `${hi}still happy to connect Instagram + Facebook whenever you are — that's how I publish and learn from your past posts. `
    + `Here's a fresh link:

${link}`
  );
}

/** Persist nudge counters on onboarding_state.answers after a successful send. */
export async function markConnectNudgeSent(brandId: string, now: Date = new Date()): Promise<void> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) return;
  const prev = brand.onboarding_state ?? { status: "done" as const };
  const state: OnboardingState = { ...prev };
  const answers: Record<string, string> = { ...(state.answers ?? {}) };
  const count = Math.max(0, Number(answers.connect_nudge_count ?? "0") || 0) + 1;
  answers.connect_nudge_count = String(count);
  answers.connect_nudge_at = now.toISOString();
  state.answers = answers;
  await query("update brands set onboarding_state = $2::jsonb where id = $1", [
    brandId,
    JSON.stringify(state),
  ]);
}

/**
 * Clear skip/nudge flags once Meta is linked — safe to call from any connect path
 * (onboarding or post-setup dashboard/SMS connect).
 */
export async function clearSkippedConnectFlags(brandId: string): Promise<void> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand?.onboarding_state?.answers?.skipped_connect) return;
  const state: OnboardingState = { ...brand.onboarding_state };
  const answers: Record<string, string> = { ...(state.answers ?? {}) };
  delete answers.skipped_connect;
  delete answers.skipped_connect_at;
  delete answers.connect_nudge_count;
  delete answers.connect_nudge_at;
  state.answers = answers;
  await query("update brands set onboarding_state = $2::jsonb where id = $1", [
    brandId,
    JSON.stringify(state),
  ]);
}
