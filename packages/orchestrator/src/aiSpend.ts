import { query, queryOne, type Brand, type BusinessFacts } from "@pulse/shared";
import { estimateCost, type CostKind, weeklyAiSpendCapUsd } from "./costEstimate.js";

/** ISO week key so weekly AI spend caps line up with calendar weeks. */
export function aiSpendWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type AiSpendState = {
  week_key: string;
  spent_usd: number;
};

function readSpend(facts: BusinessFacts | null | undefined): AiSpendState {
  const raw = facts?.ai_spend;
  if (raw && typeof raw === "object" && typeof raw.week_key === "string") {
    return {
      week_key: raw.week_key,
      spent_usd: Number(raw.spent_usd) || 0,
    };
  }
  return { week_key: aiSpendWeekKey(), spent_usd: 0 };
}

/** Current week AI spend for a brand (resets when the ISO week rolls). */
export function currentWeeklyAiSpendUsd(brand: Pick<Brand, "facts">): number {
  const state = readSpend(brand.facts);
  if (state.week_key !== aiSpendWeekKey()) return 0;
  return state.spent_usd;
}

/**
 * Hard-refuse gate for billable AI video (and optionally specialty).
 * Returns an SMS when the brand would exceed the weekly AI spend cap.
 */
export function assertAiSpendAllowed(
  brand: Pick<Brand, "facts">,
  kind: CostKind,
): string | null {
  const est = estimateCost({ kind }).usd;
  const spent = currentWeeklyAiSpendUsd(brand);
  const cap = weeklyAiSpendCapUsd();
  if (spent + est > cap) {
    return (
      `We've hit this week's AI spend cap (~$${cap.toFixed(cap % 1 === 0 ? 0 : 2)}; ` +
      `used ~$${spent.toFixed(2)}). I won't queue more AI ${kind === "video" ? "video" : "image"} until next week — ` +
      `send a clip/photo and I'll draft from that instead.`
    );
  }
  return null;
}

/** Persist an estimated AI cost against brands.facts.ai_spend for the current week. */
export async function recordAiSpend(
  brandId: string,
  kind: CostKind,
  usd?: number,
): Promise<AiSpendState> {
  const brand = await queryOne<Brand>(`select facts from brands where id = $1`, [brandId]);
  const week = aiSpendWeekKey();
  const prev = readSpend(brand?.facts);
  const base = prev.week_key === week ? prev.spent_usd : 0;
  const add = usd ?? estimateCost({ kind }).usd;
  const next: AiSpendState = { week_key: week, spent_usd: Math.round((base + add) * 1000) / 1000 };
  const facts: BusinessFacts = { ...(brand?.facts ?? {}), ai_spend: next };
  await query(`update brands set facts = $1::jsonb where id = $2`, [JSON.stringify(facts), brandId]);
  return next;
}
