import {
  query,
  queryOne,
  type Brand,
  type BusinessFacts,
  type PostFormat,
  type Pillar,
  type NichePlan,
} from "@pulse/shared";
import { adsEnabled, isAdsConnected as adsAccountConnected } from "./adsFeatures.js";
import { proposeBoost } from "./boost.js";
import { generateFillerPost } from "./fillers.js";
import type { PerfSuggestion, PerfSuggestionKind } from "./insights.js";

/** Pending suggest-only action stashed on brand.facts until the owner confirms. */
export type PerfPendingAction = {
  kind: PerfSuggestionKind | "boost_winner" | "campaign_winner";
  format?: PostFormat;
  pillar_name?: string;
  pillar_id?: string | null;
  post_id?: string;
  summary: string;
  created_at: string;
};

type FactsWithPerf = BusinessFacts & {
  kip_perf_pending?: PerfPendingAction | null;
  kip_ads_queue?: unknown[];
};

/** Alias — prefer adsFeatures.adsEnabled in new code. */
export function isAdsEnabled(brand: Brand): boolean {
  return adsEnabled(brand);
}

/** Soft connect check (tokens optional if ads_connected_at set during scaffold). */
export function isAdsConnected(brand: Brand): boolean {
  return adsAccountConnected(brand) || Boolean(brand.ad_account_id && brand.ads_connected_at);
}

export function getPerfPending(brand: Brand): PerfPendingAction | null {
  const facts = brand.facts as FactsWithPerf | null | undefined;
  return facts?.kip_perf_pending ?? null;
}

export async function savePerfPending(brand: Brand, suggestion: PerfSuggestion | null): Promise<void> {
  const facts: FactsWithPerf = { ...(brand.facts ?? {}) };
  if (!suggestion || suggestion.kind === "keep_mix") {
    facts.kip_perf_pending = null;
  } else {
    facts.kip_perf_pending = {
      kind: suggestion.kind,
      format: suggestion.format,
      pillar_name: suggestion.pillar_name,
      pillar_id: suggestion.pillar_id ?? null,
      post_id: suggestion.post_id,
      summary: suggestion.summary,
      created_at: new Date().toISOString(),
    };
  }
  await query(`update brands set facts = $1::jsonb where id = $2`, [JSON.stringify(facts), brand.id]);
  brand.facts = facts;
}

export async function clearPerfPending(brand: Brand): Promise<void> {
  await savePerfPending(brand, null);
}

// ─── Intent detectors ───────────────────────────────────────────────────────

export function looksLikeDigestRequest(body: string): boolean {
  return /\b(how did (we|i|things) do|how(?:'?s| is| are) (we|things|performance) (doing|going)|how did we do this week|weekly (recap|digest|report|summary)|performance (digest|report|recap)|what(?:'?s| is) (working|performing)|engagement (report|recap|this week)|this week(?:'?s)? (recap|digest|report)|recap (this|the) week)\b/i.test(
    body,
  );
}

export function looksLikeMakeMore(body: string): boolean {
  return /\b(make more (of )?(these|those|them|that)|more (of )?(these|those|them)|lean (that|this|the) way|do that|apply (that|the) (suggestion|insight)|post more (like )?(these|those|that)|yes.? lean)\b/i.test(
    body,
  );
}

/** Analyst-side boost/campaign phrasing (Phase F boost.ts also has looksLikeBoostRequest). */
export function looksLikeAnalystBoost(body: string): boolean {
  return /\b(boost (this|that|it|the (top |winning )?post)?|promote (this|that|it)|put (ad )?spend (on|behind) (this|that)|turn (this|that|it) into (a )?(paid )?campaign|run (ads?|a campaign) (on|for|from) (this|that|the winner)|campaign (this|that|the winner))\b/i.test(
    body,
  );
}

/** @deprecated alias — prefer looksLikeAnalystBoost or boost.looksLikeBoostRequest */
export const looksLikeBoostRequest = looksLikeAnalystBoost;

export function looksLikePerfConfirm(body: string): boolean {
  return /^\s*(yes|yep|yeah|yup|do it|go for it|sounds good|let'?s go|ok(?:ay)?|please do|apply it)\b/i.test(
    body,
  );
}

const FORMAT_WORDS: PostFormat[] = ["feed", "carousel", "story", "reel"];

function isPostFormat(v: string | undefined | null): v is PostFormat {
  return Boolean(v && (FORMAT_WORDS as string[]).includes(v));
}

/**
 * Soft handoff when the owner wants to boost / campaign an organic winner.
 * Never hard-fails if ads aren't enabled — texts "connect ads first" or queues a recommendation.
 * When ads are live, delegates to Phase F proposeBoost.
 */
export async function handoffBoostOrCampaign(
  brand: Brand,
  opts?: { postId?: string | null; kind?: "boost" | "campaign"; request?: string },
): Promise<string> {
  const pending = getPerfPending(brand);
  const postId = opts?.postId ?? pending?.post_id ?? null;
  const kind = opts?.kind ?? "boost";
  const request =
    opts?.request ??
    (postId ? `boost post_id:${postId}` : kind === "campaign" ? "turn this into a campaign" : "boost this");

  if (!adsEnabled(brand) || !isAdsConnected(brand)) {
    await queueAdsRecommendation(brand, {
      kind,
      post_id: postId,
      reason: "owner asked to boost/campaign; ads not enabled or connected",
    });
    // Soft handoff — never throw.
    try {
      const { connectLinkMessage } = await import("./smsConnect.js");
      const connect = connectLinkMessage(brand, "ads");
      return (
        `That post looks like a strong ${kind === "campaign" ? "campaign" : "boost"} candidate — connect ads first and I'll promote it for you.\n\n${connect}`
      );
    } catch {
      return `That post looks like a strong ${kind === "campaign" ? "campaign" : "boost"} candidate — connect ads first and I'll promote it for you. Say "connect ads" for a link.`;
    }
  }

  // Ads on — Phase F owns live boost / campaign creation.
  if (kind === "boost") {
    try {
      const result = await proposeBoost(brand, request);
      await clearPerfPending(brand);
      return result.summary;
    } catch (err) {
      await queueAdsRecommendation(brand, {
        kind: "boost",
        post_id: postId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return `I've queued a boost recommendation for that winner — say "boost this" again once ads are fully ready, or tell me a budget like "$20 over 3 days".`;
    }
  }

  try {
    const { proposeAdCampaign } = await import("./adCampaigns.js");
    const result = await proposeAdCampaign(
      brand,
      opts?.request ??
        `paid campaign from organic winner${postId ? ` post_id:${postId}` : ""} for traffic`,
    );
    await clearPerfPending(brand);
    return result.summary;
  } catch (err) {
    await queueAdsRecommendation(brand, {
      kind: "campaign",
      post_id: postId,
      reason: err instanceof Error ? err.message : String(err),
    });
    await clearPerfPending(brand);
    return `I've queued a paid campaign note from that winner. Say "run ads for traffic at $20/day" and I'll send a full preview before any spend.`;
  }
}

/**
 * Persist a soft recommendation for Phase F without requiring ad_campaigns to exist.
 * Tries ad_campaigns insert when available; otherwise stamps facts.kip_ads_queue.
 */
export async function queueAdsRecommendation(
  brand: Brand,
  rec: { kind: "boost" | "campaign"; post_id?: string | null; reason: string },
): Promise<boolean> {
  const facts: FactsWithPerf = { ...(brand.facts ?? {}) };
  const entry = { ...rec, queued_at: new Date().toISOString() };
  const prev = Array.isArray(facts.kip_ads_queue) ? facts.kip_ads_queue : [];
  facts.kip_ads_queue = [...prev, entry].slice(-10);

  try {
    await query(`update brands set facts = $1::jsonb where id = $2`, [JSON.stringify(facts), brand.id]);
    brand.facts = facts;
  } catch {
    /* ignore */
  }

  if (adsEnabled(brand)) {
    try {
      await query(
        `insert into ad_campaigns (
           brand_id, name, objective, status, kind, source_post_id, budget_cents, plan
         ) values (
           $1, $2, 'traffic', 'proposed', $3, $4, 0,
           $5::jsonb
         )`,
        [
          brand.id,
          rec.kind === "boost" ? "Boost from digest" : "Campaign from digest",
          rec.kind,
          rec.post_id ?? null,
          JSON.stringify({ step: "queued_from_analyst", reason: rec.reason }),
        ],
      );
    } catch {
      /* table may not exist yet */
    }
  }
  return true;
}

/**
 * Apply "make more of these" / confirm lean suggestion:
 * adjust pillar format_bias + accepted plan mix, optionally queue a draft, text what changed.
 */
export async function applyMakeMoreOfThese(brand: Brand): Promise<string> {
  const pending = getPerfPending(brand);
  if (!pending || pending.kind === "keep_mix") {
    return `I don't have a recent performance suggestion queued. Ask "how did we do this week?" first, then say "make more of these".`;
  }

  if (pending.kind === "boost_winner" || pending.kind === "campaign_winner") {
    return handoffBoostOrCampaign(brand, {
      postId: pending.post_id,
      kind: pending.kind === "campaign_winner" ? "campaign" : "boost",
    });
  }

  const changes: string[] = [];

  if (pending.kind === "lean_format" && isPostFormat(pending.format)) {
    const fmt = pending.format;
    try {
      const updated = await query(
        `update pillars set format_bias = $1
          where brand_id = $2
          returning id, name`,
        [fmt, brand.id],
      );
      if (updated.length) {
        changes.push(`set format bias → ${fmt} on ${updated.length} pillar${updated.length === 1 ? "" : "s"}`);
      }
    } catch {
      /* pre-migration */
    }

    try {
      const planRow = await queryOne<{ id: string; plan: NichePlan | null }>(
        `select id, plan from content_plans
          where brand_id = $1 and status = 'accepted'
          order by updated_at desc limit 1`,
        [brand.id],
      );
      if (planRow?.plan) {
        const next: NichePlan = {
          ...planRow.plan,
          format_mix: `${fmt}-heavy — leaning into what's working`,
          pillars: (planRow.plan.pillars ?? []).map((p) => ({ ...p, format_bias: fmt })),
        };
        await query(`update content_plans set plan = $1::jsonb, updated_at = now() where id = $2`, [
          JSON.stringify(next),
          planRow.id,
        ]);
        changes.push(`updated your content plan mix toward ${fmt}`);
      }
    } catch {
      /* ignore */
    }
  }

  if (pending.kind === "lean_pillar" && pending.pillar_name) {
    try {
      if (pending.pillar_id) {
        await query(
          `update pillars set posts_per_week = greatest(posts_per_week, 1) + 1
            where id = $1 and brand_id = $2`,
          [pending.pillar_id, brand.id],
        );
        changes.push(`bumped "${pending.pillar_name}" cadence (+1 post/wk)`);
      } else {
        const row = await queryOne<Pillar>(
          `select * from pillars where brand_id = $1 and name = $2 limit 1`,
          [brand.id, pending.pillar_name],
        );
        if (row) {
          await query(
            `update pillars set posts_per_week = greatest(posts_per_week, 1) + 1 where id = $1`,
            [row.id],
          );
          changes.push(`bumped "${pending.pillar_name}" cadence (+1 post/wk)`);
        }
      }
    } catch {
      /* ignore */
    }
  }

  let draftNote = "";
  try {
    let pillar: Pillar | null = null;
    if (pending.pillar_id) {
      pillar = await queryOne<Pillar>(`select * from pillars where id = $1 and brand_id = $2`, [
        pending.pillar_id,
        brand.id,
      ]);
    } else if (pending.pillar_name) {
      pillar = await queryOne<Pillar>(
        `select * from pillars where brand_id = $1 and name = $2 limit 1`,
        [brand.id, pending.pillar_name],
      );
    } else {
      pillar = await queryOne<Pillar>(
        `select * from pillars where brand_id = $1 order by sort, created_at limit 1`,
        [brand.id],
      );
    }
    if (pillar) {
      const drafted = await generateFillerPost(brand, pillar);
      if (drafted) {
        draftNote = `\n\nI've also queued a ${pillar.name} draft for your approval.`;
        changes.push(`queued a ${pillar.name} draft`);
      }
    }
  } catch {
    /* drafting is best-effort */
  }

  await clearPerfPending(brand);

  if (changes.length === 0) {
    return `Noted — I'll favour what's working going forward. Nothing structural to change just yet.${draftNote}`;
  }
  return `Done — ${changes.join("; ")}.${draftNote}\n\nNothing else changes until you ask.`;
}

/** Confirm the pending digest suggestion ("yes" after a recap). */
export async function confirmPerfSuggestion(brand: Brand): Promise<string | null> {
  const pending = getPerfPending(brand);
  if (!pending) return null;
  if (pending.kind === "boost_winner" || pending.kind === "campaign_winner") {
    return handoffBoostOrCampaign(brand, {
      postId: pending.post_id,
      kind: pending.kind === "campaign_winner" ? "campaign" : "boost",
    });
  }
  return applyMakeMoreOfThese(brand);
}
