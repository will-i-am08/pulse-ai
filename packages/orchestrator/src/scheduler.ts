import { query, type Platform } from "@pulse/shared";

// Smart scheduler: slot a post into the next good time window that respects the
// autopilot guardrails. Times are computed in the process's local timezone
// (TZ from env — Australia/Sydney by default), which stands in for the brand's
// timezone for now.

// Good posting hours per platform (local time, 24h).
const PLATFORM_WINDOWS: Record<Platform, number[]> = {
  instagram: [11, 13, 19],
  facebook: [9, 12, 17],
  google: [9, 12, 15],
};

const DAILY_CAP = 3; // max posts per brand per day
const MIN_SPACING_HOURS = 3; // never post two things within this window
const LEAD_MINUTES = 30; // earliest a slot may be from "now"
const HORIZON_DAYS = 28; // how far out we'll look before giving up

type Committed = { scheduled_at: string; pillar_id: string | null };

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ISO week key so weekly cadence caps line up with calendar weeks.
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

/** All future-ish committed posts for a brand (things already holding a slot). */
async function committedPosts(brandId: string, now: Date): Promise<Committed[]> {
  const since = new Date(now.getTime() - MIN_SPACING_HOURS * 3600_000).toISOString();
  return query<Committed>(
    `select scheduled_at, pillar_id from posts
      where brand_id = $1
        and status in ('pending_approval','approved','scheduled')
        and scheduled_at is not null
        and scheduled_at >= $2
      order by scheduled_at asc`,
    [brandId, since],
  );
}

/**
 * Find the next open slot for a post in this pillar. Honours: platform windows,
 * daily cap, minimum spacing, per-pillar weekly cadence, and no two of the same
 * pillar back-to-back. Falls back to now+1h if nothing fits within the horizon.
 */
export async function scheduleSlot(opts: {
  brandId: string;
  platform: Platform;
  pillarId: string | null;
  postsPerWeek: number; // this pillar's weekly cap (0 = no cap)
  now?: Date;
}): Promise<Date> {
  const now = opts.now ?? new Date();
  const windows = PLATFORM_WINDOWS[opts.platform] ?? PLATFORM_WINDOWS.instagram;
  const hours = [...windows].sort((a, b) => a - b);
  const committed = await committedPosts(opts.brandId, now);
  const times = committed.map((c) => ({ t: new Date(c.scheduled_at), pillar: c.pillar_id }));

  const earliest = new Date(now.getTime() + LEAD_MINUTES * 60_000);

  for (let dayOffset = 0; dayOffset <= HORIZON_DAYS; dayOffset++) {
    const base = new Date(now);
    base.setDate(base.getDate() + dayOffset);
    for (const hour of hours) {
      const cand = new Date(base);
      cand.setHours(hour, 0, 0, 0);
      if (cand < earliest) continue;

      // Daily cap
      const sameDay = times.filter((x) => dayKey(x.t) === dayKey(cand)).length;
      if (sameDay >= DAILY_CAP) continue;

      // Minimum spacing
      const tooClose = times.some((x) => Math.abs(x.t.getTime() - cand.getTime()) < MIN_SPACING_HOURS * 3600_000);
      if (tooClose) continue;

      // Weekly cadence for this pillar
      if (opts.postsPerWeek > 0 && opts.pillarId) {
        const sameWeekSamePillar = times.filter(
          (x) => x.pillar === opts.pillarId && weekKey(x.t) === weekKey(cand),
        ).length;
        if (sameWeekSamePillar >= opts.postsPerWeek) continue;
      }

      // No back-to-back same pillar (immediate neighbours by time)
      if (opts.pillarId) {
        const before = times.filter((x) => x.t < cand).at(-1);
        const after = times.find((x) => x.t > cand);
        if (before?.pillar === opts.pillarId || after?.pillar === opts.pillarId) continue;
      }

      return cand;
    }
  }

  // Nothing fit — post in an hour rather than dropping it.
  return new Date(now.getTime() + 3600_000);
}
