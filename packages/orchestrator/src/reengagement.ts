import { appTz, query, queryOne } from "@pulse/shared";

// Time-aware re-engagement: read the clock off the last time we spoke and, once a
// real gap has opened, re-orient the client instead of assuming seamless
// continuity ("morning! we left a photo waiting your yes last night — pick it up,
// or start fresh?"). Times use the resolved app timezone (Australia/Sydney by
// default), standing in for the brand's timezone — same as the scheduler.

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type GapBucket = "seamless" | "today" | "yesterday" | "recent" | "long";
export interface GapInfo {
  gapMs: number;
  bucket: GapBucket;
  /** Human phrase for when we last spoke, e.g. "this morning", "last night". Empty when seamless. */
  phrase: string;
}

/** Local YYYY-MM-DD for a date in a timezone (en-CA gives ISO order). */
function localYmd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Local hour (0–23) for a date in a timezone. */
function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);
  return parseInt(h, 10) % 24;
}

/** Whole local-calendar days from a→b (0 = same day, 1 = b is the next day). */
function localDayDiff(a: Date, b: Date, tz: string): number {
  const da = Date.parse(`${localYmd(a, tz)}T00:00:00Z`);
  const db = Date.parse(`${localYmd(b, tz)}T00:00:00Z`);
  return Math.round((db - da) / DAY_MS);
}

/**
 * Classify the gap since we last spoke into a bucket + a human phrase.
 * Under 4h is "seamless" — carry on as if mid-conversation. Above that, the
 * phrasing adapts to the clock (this morning / last night / the other day / a while).
 */
export function gapInfo(lastAt: Date | null, now: Date, tz: string = appTz()): GapInfo {
  if (!lastAt) return { gapMs: Infinity, bucket: "long", phrase: "it's been a while" };
  const gapMs = now.getTime() - lastAt.getTime();
  if (gapMs < FOUR_HOURS_MS) return { gapMs, bucket: "seamless", phrase: "" };

  const dayDiff = localDayDiff(lastAt, now, tz);
  const lastHour = localHour(lastAt, tz);

  if (dayDiff <= 0) {
    const phrase = lastHour < 12 ? "this morning" : lastHour < 17 ? "earlier today" : "earlier this evening";
    return { gapMs, bucket: "today", phrase };
  }
  if (dayDiff === 1) {
    return { gapMs, bucket: "yesterday", phrase: lastHour >= 17 ? "last night" : "yesterday" };
  }
  if (dayDiff <= 6) return { gapMs, bucket: "recent", phrase: "the other day" };
  return { gapMs, bucket: "long", phrase: "it's been a while" };
}

/**
 * Whether `now` falls in sociable local hours (default 8am–7pm) for the timezone —
 * so proactive nudges never fire in the middle of the night. `endHour` is
 * exclusive (19 → last OK hour is 18:xx).
 */
export function isDaytime(now: Date, tz: string = appTz(), startHour = 8, endHour = 19): boolean {
  const h = localHour(now, tz);
  return h >= startHour && h < endHour;
}

/** Timestamp of the most recent message either direction, excluding the current one. */
export async function lastInteractionAt(brandId: string, excludeMessageId: string): Promise<Date | null> {
  const rows = await query<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and id <> $2
      order by created_at desc
      limit 1`,
    [brandId, excludeMessageId],
  );
  return rows[0] ? new Date(rows[0].created_at) : null;
}

export type ActionableKind = "draft" | "campaign" | "question";
export interface Actionable {
  kind: ActionableKind;
  /** Short human summary to weave into a re-orient, e.g. "your BTS post waiting your yes". */
  summary: string;
}

/**
 * The single most recent unfinished thing worth surfacing on return:
 * a pending draft, then a proposed campaign, then a question we asked that
 * was never answered. null when nothing is outstanding.
 */
export async function mostRecentActionable(brandId: string): Promise<Actionable | null> {
  const draft = await queryOne<{ caption: string | null; pillar_name: string | null }>(
    `select p.caption, pl.name as pillar_name
       from posts p left join pillars pl on pl.id = p.pillar_id
      where p.brand_id = $1 and p.status = 'pending_approval'
      order by p.created_at desc
      limit 1`,
    [brandId],
  );
  if (draft) {
    return { kind: "draft", summary: draft.pillar_name ? `your ${draft.pillar_name} post` : "a post I drafted" };
  }

  // Surfacing only — no 20-minute freshness window here (that guard is for acting on "yes").
  const campaign = await queryOne<{ name: string | null }>(
    `select name from campaigns
      where brand_id = $1 and status = 'proposed'
      order by created_at desc
      limit 1`,
    [brandId],
  );
  if (campaign) {
    return { kind: "campaign", summary: campaign.name ? `the ${campaign.name} campaign` : "a campaign" };
  }

  const last = await queryOne<{ direction: string; body: string | null }>(
    `select direction, body from messages where brand_id = $1 order by created_at desc limit 1`,
    [brandId],
  );
  if (last && last.direction === "outbound" && (last.body ?? "").trim().endsWith("?")) {
    return { kind: "question", summary: "my last question" };
  }

  return null;
}
