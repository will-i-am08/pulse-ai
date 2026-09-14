import type { Platform, PostFormat, AdCampaignMetrics } from "@pulse/shared";

// Closed-loop learning: look at what's actually performing and turn it into one
// insight + one recommendation the owner can act on. Per the product decision,
// the agent SUGGESTS a shift — it never silently changes the strategy.

export type PostPerf = {
  id?: string;
  caption: string | null;
  pillar_name: string | null;
  pillar_id?: string | null;
  platform: Platform;
  /** feed | carousel | story | reel — compared when present (Phase E2 / G1). */
  format?: PostFormat | string | null;
  scheduled_at: string | null;
  engagement: Record<string, number>;
};

/** Aggregated paid metrics for the digest (Phase F fills; omit when ads off). */
export type PaidDigestMetrics = {
  spend_cents?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpa_cents?: number | null;
  roas?: number | null;
  campaigns?: number;
};

export type OrganicWinner = {
  id?: string;
  caption: string | null;
  score: number;
  format?: string | null;
  pillar_name?: string | null;
};

export type PerfSuggestionKind =
  | "lean_format"
  | "lean_pillar"
  | "boost_winner"
  | "keep_mix";

/** Suggest-only action — applied only after the owner confirms. */
export type PerfSuggestion = {
  kind: PerfSuggestionKind;
  format?: PostFormat;
  pillar_name?: string;
  pillar_id?: string | null;
  post_id?: string;
  summary: string;
};

export type PerformanceAnalysis = {
  text: string;
  insight: string;
  recommendation: string;
  winners: OrganicWinner[];
  suggestion: PerfSuggestion | null;
  enoughData: boolean;
};

const score = (e: Record<string, number> | null | undefined): number => {
  if (!e) return 0;
  const likes = Number(e.likes ?? e.like_count ?? 0) || 0;
  const comments = Number(e.comments ?? e.comment_count ?? 0) || 0;
  const saves = Number(e.saves ?? e.saved ?? 0) || 0;
  const shares = Number(e.shares ?? e.sends ?? e.shares_count ?? 0) || 0;
  const reach = Number(e.reach ?? e.impressions ?? e.views ?? 0) || 0;
  const hold = Number(e.hold_at_3s ?? e.holds_at_3 ?? e.ig_reels_avg_watch_time ?? 0) || 0;
  // Prefer quality signals Jake cares about when Meta provides them.
  const sendsPerReach = reach > 0 ? shares / reach : 0;
  const base = likes + comments * 2 + saves * 3 + shares * 4;
  const qualityBoost = sendsPerReach * 200 + (hold > 0 && hold < 60 ? hold * 2 : 0);
  return base + qualityBoost;
};

/** Extra analyst line when Insights include hold/sends/reach. */
export function qualitySignalsLine(e: Record<string, number> | null | undefined): string | null {
  if (!e) return null;
  const reach = Number(e.reach ?? e.impressions ?? e.views ?? 0) || 0;
  const shares = Number(e.shares ?? e.sends ?? 0) || 0;
  const hold = Number(e.hold_at_3s ?? e.holds_at_3 ?? 0) || 0;
  const bits: string[] = [];
  if (reach > 0 && shares > 0) bits.push(`sends/reach ${(shares / reach * 100).toFixed(1)}%`);
  if (hold > 0) bits.push(`hold@3s ${hold}${hold <= 1 ? "" : "s"}`);
  const nonFollow = Number(e.non_follower_reach ?? e.reach_from_non_followers ?? 0) || 0;
  if (reach > 0 && nonFollow > 0) bits.push(`non-follower reach ${Math.round((nonFollow / reach) * 100)}%`);
  return bits.length ? bits.join(" · ") : null;
}

function partOfDay(iso: string | null): string {
  if (!iso) return "anytime";
  const h = new Date(iso).getHours();
  if (h < 11) return "mornings";
  if (h < 15) return "midday";
  if (h < 19) return "afternoons";
  return "evenings";
}

function formatLabel(f: string | null | undefined): string {
  if (!f) return "posts";
  if (f === "feed") return "feed posts";
  if (f === "carousel") return "carousels";
  if (f === "story") return "stories";
  if (f === "reel") return "reels";
  return f;
}

function avgMap(entries: Map<string, number[]>): Array<{ k: string; avg: number; n: number }> {
  return [...entries.entries()]
    .map(([k, arr]) => ({ k, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
    .sort((a, b) => b.avg - a.avg);
}

function formatCtr(ctr: number): string {
  const pct = ctr > 1 ? ctr : ctr * 100;
  return `${pct.toFixed(1)}%`;
}

/** Build a one-line paid summary for tests / SMS (graceful empty). */
export function summarizePaidMetrics(paid: PaidDigestMetrics | null | undefined): string | null {
  if (!paid) return null;
  const bits: string[] = [];
  if (typeof paid.spend_cents === "number") bits.push(`$${((paid.spend_cents ?? 0) / 100).toFixed(2)} spend`);
  if (typeof paid.ctr === "number" && paid.ctr > 0) bits.push(`${formatCtr(paid.ctr)} CTR`);
  if (typeof paid.cpa_cents === "number" && paid.cpa_cents > 0) {
    bits.push(`$${(paid.cpa_cents / 100).toFixed(2)} CPA`);
  }
  if (typeof paid.roas === "number" && paid.roas > 0) bits.push(`${paid.roas.toFixed(1)}× ROAS`);
  return bits.length ? bits.join(" · ") : null;
}

function formatPaidLine(paid: PaidDigestMetrics | null | undefined): string {
  const summary = summarizePaidMetrics(paid);
  return summary ? `\n\n💸 Ads this period: ${summary}` : "";
}

/**
 * Aggregate raw AdCampaignMetrics rows into a digest stub (Phase F can swap the source).
 */
export function aggregateAdMetrics(rows: AdCampaignMetrics[]): PaidDigestMetrics | null {
  if (!rows.length) return null;
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let leads = 0;
  let purchases = 0;
  let revenueProxy = 0;
  for (const m of rows) {
    spend += Number(m.spend_cents) || 0;
    impressions += Number(m.impressions) || 0;
    clicks += Number(m.clicks) || 0;
    leads += Number(m.leads) || 0;
    purchases += Number(m.purchases) || 0;
    if (typeof m.roas === "number" && typeof m.spend_cents === "number") {
      revenueProxy += m.roas * m.spend_cents;
    }
  }
  const ctr = impressions > 0 ? clicks / impressions : undefined;
  const results = leads + purchases;
  const cpa = results > 0 && spend > 0 ? Math.round(spend / results) : null;
  const roas = spend > 0 && revenueProxy > 0 ? revenueProxy / spend : null;
  return {
    spend_cents: spend,
    impressions,
    clicks,
    ctr,
    cpa_cents: cpa,
    roas,
    campaigns: rows.length,
  };
}

/**
 * Turn a set of published posts + their engagement into an actionable digest.
 * Compares formats (feed/carousel/story/reel), pillars, and timing when data exists.
 * Always suggest-only — never mutates strategy.
 */
export function analyzePerformance(
  posts: PostPerf[],
  opts?: { paid?: PaidDigestMetrics | null },
): PerformanceAnalysis {
  const withEng = posts.filter((p) => score(p.engagement) > 0);
  if (withEng.length < 3) {
    const text =
      "📊 Weekly recap\n\nNot enough published posts with data yet to spot real patterns — I'll have proper insights for you once a few more go out.";
    return {
      text,
      insight: "Not enough data yet.",
      recommendation: "Publish a few more posts and ask me again.",
      winners: [],
      suggestion: null,
      enoughData: false,
    };
  }

  const scored = withEng.map((p) => ({ ...p, s: score(p.engagement) }));
  const total = scored.reduce((a, p) => a + p.s, 0);
  const ranked = [...scored].sort((a, b) => b.s - a.s);
  const top = ranked[0]!;
  const winners: OrganicWinner[] = ranked.slice(0, 3).map((p) => ({
    id: p.id,
    caption: p.caption,
    score: p.s,
    format: p.format ?? null,
    pillar_name: p.pillar_name,
  }));

  const byPillar = new Map<string, number[]>();
  for (const p of scored) {
    const k = p.pillar_name ?? "Unsorted";
    (byPillar.get(k) ?? byPillar.set(k, []).get(k)!).push(p.s);
  }
  const pillarAvg = avgMap(byPillar);
  const bestPillar = pillarAvg[0];
  const worstPillar = pillarAvg[pillarAvg.length - 1];

  const byFormat = new Map<string, number[]>();
  for (const p of scored) {
    const k = (p.format && String(p.format)) || "unknown";
    if (k === "unknown") continue;
    (byFormat.get(k) ?? byFormat.set(k, []).get(k)!).push(p.s);
  }
  const formatAvg = avgMap(byFormat);
  const bestFormat = formatAvg.find((f) => f.n >= 1) ?? null;
  const comparableFormats = formatAvg.filter((f) => f.n >= 1);
  const worstFormat =
    comparableFormats.length >= 2 ? comparableFormats[comparableFormats.length - 1] : null;

  const byTime = new Map<string, number[]>();
  for (const p of scored) {
    const k = partOfDay(p.scheduled_at);
    (byTime.get(k) ?? byTime.set(k, []).get(k)!).push(p.s);
  }
  const timeAvg = avgMap(byTime);
  const bestTime = timeAvg[0];

  let insight: string;
  let rec: string;
  let suggestion: PerfSuggestion | null = null;

  if (
    bestFormat &&
    worstFormat &&
    bestFormat.k !== worstFormat.k &&
    worstFormat.avg > 0 &&
    comparableFormats.length >= 2
  ) {
    const ratio = (bestFormat.avg / worstFormat.avg).toFixed(1);
    insight = `Your ${formatLabel(bestFormat.k)} are pulling ${ratio}× the engagement of your ${formatLabel(worstFormat.k)}.`;
    rec = `Want me to lean your mix toward ${formatLabel(bestFormat.k)}?`;
    suggestion = {
      kind: "lean_format",
      format: bestFormat.k as PostFormat,
      summary: `Lean mix toward ${formatLabel(bestFormat.k)}`,
      post_id: winners[0]?.id,
    };
  } else if (bestPillar && worstPillar && bestPillar.k !== worstPillar.k && worstPillar.avg > 0) {
    const ratio = (bestPillar.avg / worstPillar.avg).toFixed(1);
    insight = `Your ${bestPillar.k} posts are pulling ${ratio}× the engagement of your ${worstPillar.k} posts.`;
    rec = `Want me to lean your mix toward ${bestPillar.k}?`;
    const pillarPost = scored.find((p) => (p.pillar_name ?? "Unsorted") === bestPillar.k);
    suggestion = {
      kind: "lean_pillar",
      pillar_name: bestPillar.k,
      pillar_id: pillarPost?.pillar_id ?? null,
      summary: `Lean mix toward ${bestPillar.k}`,
      post_id: winners[0]?.id,
    };
  } else if (bestFormat) {
    insight = `${formatLabel(bestFormat.k)} are your strongest format right now.`;
    rec = `Want me to post a bit more ${formatLabel(bestFormat.k)}?`;
    suggestion = {
      kind: "lean_format",
      format: bestFormat.k as PostFormat,
      summary: `Post more ${formatLabel(bestFormat.k)}`,
      post_id: winners[0]?.id,
    };
  } else if (bestPillar) {
    insight = `${bestPillar.k} is your strongest pillar right now.`;
    rec = `Want me to post a bit more ${bestPillar.k}?`;
    suggestion = {
      kind: "lean_pillar",
      pillar_name: bestPillar.k,
      pillar_id: scored.find((p) => (p.pillar_name ?? "Unsorted") === bestPillar.k)?.pillar_id ?? null,
      summary: `Post more ${bestPillar.k}`,
      post_id: winners[0]?.id,
    };
  } else {
    insight = "Engagement's steady across your pillars.";
    rec = "Want me to keep the mix as is?";
    suggestion = { kind: "keep_mix", summary: "Keep the current mix" };
  }

  if (bestTime && bestTime.k !== "anytime") {
    rec += ` Your ${bestTime.k} slots do best, so I'll favour those.`;
  }

  const quality = qualitySignalsLine(top.engagement);
  const topLine = top.caption
    ? `"${top.caption.slice(0, 80)}${top.caption.length > 80 ? "…" : ""}"`
    : "(a recent post)";
  const winnerLines = winners
    .map((w, i) => {
      const cap = w.caption
        ? `"${w.caption.slice(0, 60)}${w.caption.length > 60 ? "…" : ""}"`
        : "(untitled)";
      const meta = [w.format, w.pillar_name].filter(Boolean).join(" · ");
      return `${i + 1}. ${cap} (${w.score}${meta ? ` · ${meta}` : ""})`;
    })
    .join("\n");

  rec +=
    `\n\n🏆 Organic winners to boost or turn into a campaign:\n${winnerLines}` +
    `\n\nReply "make more of these", "boost this", or "yes" to apply the suggestion — I won't change anything until you confirm.`;

  if (suggestion && winners[0]?.id) {
    suggestion = { ...suggestion, post_id: winners[0].id };
  }

  const paidLine = formatPaidLine(opts?.paid ?? null);

  const qualityNote = quality ? `\nQuality: ${quality}` : "";
  return {
    text:
      `📊 Weekly recap\n\n` +
      `${scored.length} posts · ${total} total interactions.\n\n` +
      `⭐ Top post: ${topLine} (${top.s} interactions)\n\n` +
      `💡 ${insight}\n\n` +
      `👉 ${rec}` +
      qualityNote +
      paidLine,
    insight,
    recommendation: rec + (quality ? ` (${quality})` : ""),
    winners,
    suggestion,
    enoughData: true,
  };
}
