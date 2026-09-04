import type { Platform } from "@pulse/shared";

// Closed-loop learning: look at what's actually performing and turn it into one
// insight + one recommendation the owner can act on. Per the product decision,
// the agent SUGGESTS a shift — it never silently changes the strategy.

export type PostPerf = {
  caption: string | null;
  pillar_name: string | null;
  platform: Platform;
  scheduled_at: string | null;
  engagement: Record<string, number>;
};

const score = (e: Record<string, number> | null | undefined): number =>
  Object.values(e ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

function partOfDay(iso: string | null): string {
  if (!iso) return "anytime";
  const h = new Date(iso).getHours();
  if (h < 11) return "mornings";
  if (h < 15) return "midday";
  if (h < 19) return "afternoons";
  return "evenings";
}

/**
 * Turn a set of published posts + their engagement into an actionable digest.
 * Returns the message text, or a gentle "not enough data" note.
 */
export function analyzePerformance(posts: PostPerf[]): { text: string } {
  const withEng = posts.filter((p) => score(p.engagement) > 0);
  if (withEng.length < 3) {
    return {
      text: "📊 Weekly recap\n\nNot enough published posts with data yet to spot real patterns — I'll have proper insights for you once a few more go out.",
    };
  }

  const scored = withEng.map((p) => ({ ...p, s: score(p.engagement) }));
  const total = scored.reduce((a, p) => a + p.s, 0);
  const top = scored.reduce((a, b) => (b.s > a.s ? b : a));

  // Average score per pillar.
  const byPillar = new Map<string, number[]>();
  for (const p of scored) {
    const k = p.pillar_name ?? "Unsorted";
    (byPillar.get(k) ?? byPillar.set(k, []).get(k)!).push(p.s);
  }
  const pillarAvg = [...byPillar.entries()]
    .map(([k, arr]) => ({ k, avg: arr.reduce((a, b) => a + b, 0) / arr.length }))
    .sort((a, b) => b.avg - a.avg);
  const best = pillarAvg[0];
  const worst = pillarAvg[pillarAvg.length - 1];

  // Best time of day.
  const byTime = new Map<string, number[]>();
  for (const p of scored) {
    const k = partOfDay(p.scheduled_at);
    (byTime.get(k) ?? byTime.set(k, []).get(k)!).push(p.s);
  }
  const timeAvg = [...byTime.entries()]
    .map(([k, arr]) => ({ k, avg: arr.reduce((a, b) => a + b, 0) / arr.length }))
    .sort((a, b) => b.avg - a.avg);
  const bestTime = timeAvg[0];

  // One insight + one recommendation.
  let insight: string;
  let rec: string;
  if (best && worst && best.k !== worst.k && worst.avg > 0) {
    const ratio = (best.avg / worst.avg).toFixed(1);
    insight = `Your ${best.k} posts are pulling ${ratio}× the engagement of your ${worst.k} posts.`;
    rec = `Want me to lean your mix toward ${best.k}?`;
  } else if (best) {
    insight = `${best.k} is your strongest pillar right now.`;
    rec = `Want me to post a bit more ${best.k}?`;
  } else {
    insight = "Engagement's steady across your pillars.";
    rec = "Want me to keep the mix as is?";
  }
  if (bestTime && bestTime.k !== "anytime") {
    rec += ` Your ${bestTime.k} slots do best, so I'll favour those.`;
  }

  const topLine = top.caption ? `"${top.caption.slice(0, 80)}${top.caption.length > 80 ? "…" : ""}"` : "(a recent post)";

  return {
    text:
      `📊 Weekly recap\n\n` +
      `${scored.length} posts · ${total} total interactions.\n\n` +
      `⭐ Top post: ${topLine} (${top.s} interactions)\n\n` +
      `💡 ${insight}\n\n` +
      `👉 ${rec}`,
  };
}
