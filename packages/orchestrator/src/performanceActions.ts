import {
  query, queryOne, type Brand, type BusinessFacts, type PostFormat, type Pillar, type NichePlan,
} from "@pulse/shared";
import { adsEnabled, isAdsConnected as adsAccountConnected } from "./adsFeatures.js";
import { proposeBoost } from "./boost.js";
import { generateFillerPost } from "./fillers.js";
import type { PerfSuggestion, PerfSuggestionKind } from "./insights.js";

export type PerfPendingAction = {
  kind: PerfSuggestionKind | "boost_winner" | "campaign_winner";
  format?: PostFormat; pillar_name?: string; pillar_id?: string | null;
  post_id?: string; summary: string; created_at: string;
};
type FactsWithPerf = BusinessFacts & { kip_perf_pending?: PerfPendingAction | null; kip_ads_queue?: unknown[] };

export function isAdsEnabled(brand: Brand): boolean { return adsEnabled(brand); }
export function isAdsConnected(brand: Brand): boolean {
  return adsAccountConnected(brand) || Boolean(brand.ad_account_id && brand.ads_connected_at);
}
export function getPerfPending(brand: Brand): PerfPendingAction | null {
  return (brand.facts as FactsWithPerf | null | undefined)?.kip_perf_pending ?? null;
}
export async function savePerfPending(brand: Brand, suggestion: PerfSuggestion | null): Promise<void> {
  const facts: FactsWithPerf = { ...(brand.facts ?? {}) };
  if (!suggestion || suggestion.kind === "keep_mix") facts.kip_perf_pending = null;
  else {
    facts.kip_perf_pending = {
      kind: suggestion.kind, format: suggestion.format, pillar_name: suggestion.pillar_name,
      pillar_id: suggestion.pillar_id ?? null, post_id: suggestion.post_id, summary: suggestion.summary,
      created_at: new Date().toISOString(),
    };
  }
  await query(`update brands set facts=$1::jsonb where id=$2`, [JSON.stringify(facts), brand.id]);
  brand.facts = facts;
}
export async function clearPerfPending(brand: Brand): Promise<void> { await savePerfPending(brand, null); }

export function looksLikeDigestRequest(body: string): boolean {
  return /\b(how did (we|i|things) do|how(?:'?s| is| are) (we|things|performance) (doing|going)|weekly (recap|digest|report|summary)|performance (digest|report|recap)|what(?:'?s| is) (working|performing)|engagement (report|recap|this week))\b/i.test(body);
}
export function looksLikeMakeMore(body: string): boolean {
  return /\b(make more (of )?(these|those|them|that)|more (of )?(these|those|them)|lean (that|this|the) way|yes.? lean)\b/i.test(body);
}
export function looksLikeAnalystBoost(body: string): boolean {
  return /\b(boost (this|that|it|the (top |winning )?post)?|promote (this|that|it)|turn (this|that|it) into (a )?(paid )?campaign|campaign (this|that|the winner))\b/i.test(body);
}
export const looksLikeBoostRequest = looksLikeAnalystBoost;
export function looksLikePerfConfirm(body: string): boolean {
  return /^\s*(yes|yep|yeah|yup|do it|go for it|sounds good|let'?s go|ok(?:ay)?|please do|apply it)\b/i.test(body);
}

export async function handoffBoostOrCampaign(
  brand: Brand, opts?: { postId?: string | null; kind?: "boost" | "campaign"; request?: string },
): Promise<string> {
  const pending = getPerfPending(brand);
  const postId = opts?.postId ?? pending?.post_id ?? null;
  const kind = opts?.kind ?? "boost";
  const request = opts?.request ?? (postId ? `boost post_id:${postId}` : kind === "campaign" ? "turn this into a campaign" : "boost this");
  if (!adsEnabled(brand) || !isAdsConnected(brand)) {
    await queueAdsRecommendation(brand, { kind, post_id: postId, reason: "ads not enabled or connected" });
    const { connectLinkMessage } = await import("./smsConnect.js");
    return `That post looks like a strong ${kind} candidate — connect ads first and I'll promote it for you.\n\n${connectLinkMessage(brand, "ads")}`;
  }
  if (kind === "boost") {
    const result = await proposeBoost(brand, request);
    await clearPerfPending(brand);
    return result.summary;
  }
  const { proposeAdCampaign } = await import("./adCampaigns.js");
  const result = await proposeAdCampaign(brand, opts?.request ?? `paid campaign from organic winner for traffic`);
  await clearPerfPending(brand);
  return result.summary;
}

export async function queueAdsRecommendation(
  brand: Brand, rec: { kind: "boost" | "campaign"; post_id?: string | null; reason: string },
): Promise<boolean> {
  const facts: FactsWithPerf = { ...(brand.facts ?? {}) };
  const prev = Array.isArray(facts.kip_ads_queue) ? facts.kip_ads_queue : [];
  facts.kip_ads_queue = [...prev, { ...rec, queued_at: new Date().toISOString() }].slice(-10);
  try {
    await query(`update brands set facts=$1::jsonb where id=$2`, [JSON.stringify(facts), brand.id]);
    brand.facts = facts;
  } catch { /* ignore */ }
  if (adsEnabled(brand)) {
    try {
      await query(
        `insert into ad_campaigns (brand_id,name,objective,status,kind,source_post_id,budget_cents,plan)
         values ($1,$2,'traffic','proposed',$3,$4,0,$5::jsonb)`,
        [brand.id, rec.kind === "boost" ? "Boost from digest" : "Campaign from digest", rec.kind, rec.post_id ?? null,
         JSON.stringify({ step: "queued_from_analyst", reason: rec.reason })],
      );
    } catch { /* table may not exist */ }
  }
  return true;
}

export async function applyMakeMoreOfThese(brand: Brand): Promise<string> {
  const pending = getPerfPending(brand);
  if (!pending || pending.kind === "keep_mix") {
    return `I don't have a recent performance suggestion queued. Ask "how did we do this week?" first.`;
  }
  if (pending.kind === "boost_winner" || pending.kind === "campaign_winner") {
    return handoffBoostOrCampaign(brand, { postId: pending.post_id, kind: pending.kind === "campaign_winner" ? "campaign" : "boost" });
  }
  const changes: string[] = [];
  if (pending.kind === "lean_format" && pending.format) {
    try {
      const updated = await query(`update pillars set format_bias=$1 where brand_id=$2 returning id`, [pending.format, brand.id]);
      if (updated.length) changes.push(`set format bias → ${pending.format}`);
    } catch { /* ignore */ }
  }
  if (pending.kind === "lean_pillar" && pending.pillar_name) {
    try {
      if (pending.pillar_id) {
        await query(`update pillars set posts_per_week = greatest(posts_per_week,1)+1 where id=$1 and brand_id=$2`,
          [pending.pillar_id, brand.id]);
        changes.push(`bumped "${pending.pillar_name}" cadence`);
      }
    } catch { /* ignore */ }
  }
  await clearPerfPending(brand);
  return changes.length ? `Done — ${changes.join("; ")}.` : `Noted — I'll favour what's working going forward.`;
}

export async function confirmPerfSuggestion(brand: Brand): Promise<string | null> {
  const pending = getPerfPending(brand);
  if (!pending) return null;
  if (pending.kind === "boost_winner" || pending.kind === "campaign_winner") {
    return handoffBoostOrCampaign(brand, { postId: pending.post_id, kind: pending.kind === "campaign_winner" ? "campaign" : "boost" });
  }
  return applyMakeMoreOfThese(brand);
}
