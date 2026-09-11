import { query, schedulePinSchema, type Platform, type PostFormat, type SchedulePin } from "@pulse/shared";

// Smart scheduler: slot a post into the next good time window that respects the
// autopilot guardrails. Times are computed in the process's local timezone
// (TZ from env — Australia/Sydney by default), which stands in for the brand's
// timezone for now.
//
// Variation by default: the window order is shuffled per day and each candidate
// gets a random minute, so repeated weekly cadences don't land at the exact
// same time every week. A pillar with a pinned slot (schedule_pin — set when
// the client asks for e.g. "BTS every Tuesday at 6pm") always posts at that
// exact day+time instead.
//
// Calendar format conflicts: when `format` is passed, a candidate day that
// already has an approved/scheduled (or pending_approval) post in the *same*
// format is skipped — we nudge to the next open slot instead of stacking two
// carousels (or two Reels, etc.) on one day. Different formats on the same day
// are fine (subject to the daily cap + spacing).

// Good posting hours per platform (local time, 24h).
const PLATFORM_WINDOWS: Record<Platform, number[]> = {
  instagram: [11, 13, 19],
  facebook: [9, 12, 17],
  x: [9, 12, 18],
  threads: [11, 13, 19],
  linkedin: [8, 12, 17],
  tiktok: [12, 17, 20],
};

const DAILY_CAP = 3; // max posts per brand per day
const MIN_SPACING_HOURS = 3; // never post two things within this window
const LEAD_MINUTES = 30; // earliest a slot may be from "now"
const HORIZON_DAYS = 28; // how far out we'll look before giving up

type Committed = { scheduled_at: string; pillar_id: string | null; format: PostFormat | null };

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

/**
 * Fisher-Yates shuffle using an injectable random source (defaults to
 * Math.random). Shuffling the window order per day stops every pillar landing
 * in the same hour every week while still filling the earliest open day first.
 */
function shuffled<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** All future-ish committed posts for a brand (things already holding a slot). */
async function committedPosts(brandId: string, now: Date): Promise<Committed[]> {
  const since = new Date(now.getTime() - MIN_SPACING_HOURS * 3600_000).toISOString();
  return query<Committed>(
    `select scheduled_at, pillar_id, format from posts
      where brand_id = $1
        and status in ('pending_approval','approved','scheduled')
        and scheduled_at is not null
        and scheduled_at >= $2
      order by scheduled_at asc`,
    [brandId, since],
  );
}

/**
 * Normalise a raw schedule_pin value into a usable pin, or null when there is
 * no pin (flex / empty / malformed). A pin is only valid with at least one
 * matching day plus a concrete hour/minute.
 */
export function normalizePin(raw: unknown): SchedulePin | null {
  const parsed = schedulePinSchema.safeParse(raw ?? {});
  if (!parsed.success) return null;
  const pin = parsed.data;
  if (pin.mode === "weekly" && pin.weekdays.length === 0) return null;
  if (pin.mode === "monthly" && pin.monthDays.length === 0) return null;
  if (pin.mode === "flex") return null;
  return pin;
}

/** Does this calendar date match the pin's day rule (ignoring time)? */
function pinDayMatches(pin: SchedulePin, d: Date): boolean {
  if (pin.mode === "weekly") return pin.weekdays.includes(d.getDay());
  if (pin.mode === "monthly") return pin.monthDays.includes(d.getDate());
  return false;
}

/**
 * Load a pillar's pin from the DB. Tolerant of a DB that hasn't run migration
 * 0021 yet (missing column) — treats it as "no pin" rather than failing.
 */
async function loadPin(pillarId: string): Promise<SchedulePin | null> {
  try {
    const rows = await query<{ schedule_pin: unknown }>(
      `select schedule_pin from pillars where id = $1 limit 1`,
      [pillarId],
    );
    return normalizePin(rows[0]?.schedule_pin);
  } catch (err) {
    console.error("scheduleSlot: pin lookup failed (treating as flex)", err);
    return null;
  }
}

type SlotTime = { t: Date; pillar: string | null; format: PostFormat | null };

/** Shared guardrail check: may `cand` hold a post for this pillar/format? */
function slotIsFree(
  cand: Date,
  times: SlotTime[],
  opts: { pillarId: string | null; postsPerWeek: number; format?: PostFormat | null },
): boolean {
  // Daily cap
  const sameDay = times.filter((x) => dayKey(x.t) === dayKey(cand)).length;
  if (sameDay >= DAILY_CAP) return false;

  // Same-day same-format conflict — pick the next slot instead of stacking.
  if (opts.format) {
    const sameFormatSameDay = times.some(
      (x) => dayKey(x.t) === dayKey(cand) && x.format === opts.format,
    );
    if (sameFormatSameDay) return false;
  }

  // Minimum spacing
  const tooClose = times.some(
    (x) => Math.abs(x.t.getTime() - cand.getTime()) < MIN_SPACING_HOURS * 3600_000,
  );
  if (tooClose) return false;

  // Weekly cadence for this pillar
  if (opts.postsPerWeek > 0 && opts.pillarId) {
    const sameWeekSamePillar = times.filter(
      (x) => x.pillar === opts.pillarId && weekKey(x.t) === weekKey(cand),
    ).length;
    if (sameWeekSamePillar >= opts.postsPerWeek) return false;
  }

  // No back-to-back same pillar (immediate neighbours by time)
  if (opts.pillarId) {
    const before = times.filter((x) => x.t < cand).at(-1);
    const after = times.find((x) => x.t > cand);
    if (before?.pillar === opts.pillarId || after?.pillar === opts.pillarId) return false;
  }

  return true;
}

/**
 * Find the next open slot for a post in this pillar. Honours: platform windows,
 * daily cap, minimum spacing, per-pillar weekly cadence, no two of the same
 * pillar back-to-back, and (when `format` is set) no second post of the same
 * format on the same calendar day.
 *
 * Pinned pillars (the client asked for a fixed day+time) post at that exact
 * slot — no jitter. Everything else shuffles windows per day with a random
 * minute so the schedule varies week to week. Falls back to now+1h-ish if
 * nothing fits within the horizon.
 */
export async function scheduleSlot(opts: {
  brandId: string;
  platform: Platform;
  pillarId: string | null;
  postsPerWeek: number; // this pillar's weekly cap (0 = no cap)
  /** When set, skip days that already have this format approved/scheduled. */
  format?: PostFormat | null;
  now?: Date;
  random?: () => number; // injectable source for tests; defaults to Math.random
  pin?: SchedulePin | null; // explicit pin; looked up from the pillar when omitted
}): Promise<Date> {
  const now = opts.now ?? new Date();
  const rand = opts.random ?? Math.random;
  const windows = PLATFORM_WINDOWS[opts.platform] ?? PLATFORM_WINDOWS.instagram;
  const hours = [...windows].sort((a, b) => a - b);
  const committed = await committedPosts(opts.brandId, now);
  const times: SlotTime[] = committed.map((c) => ({
    t: new Date(c.scheduled_at),
    pillar: c.pillar_id,
    format: c.format,
  }));
  const guard = { pillarId: opts.pillarId, postsPerWeek: opts.postsPerWeek, format: opts.format ?? null };

  const earliest = new Date(now.getTime() + LEAD_MINUTES * 60_000);

  // Pinned slot first: exact day+time the client asked for, earliest match that
  // passes the guardrails. Strictly pin-matching days only, so "every Tuesday
  // at 6pm" really means Tuesdays at 6pm.
  const pin = opts.pin !== undefined ? normalizePin(opts.pin) : opts.pillarId ? await loadPin(opts.pillarId) : null;
  if (pin) {
    for (let dayOffset = 0; dayOffset <= HORIZON_DAYS; dayOffset++) {
      const base = new Date(now);
      base.setDate(base.getDate() + dayOffset);
      if (!pinDayMatches(pin, base)) continue;
      const cand = new Date(base);
      cand.setHours(pin.hour, pin.minute, 0, 0);
      if (cand < earliest) continue;
      if (slotIsFree(cand, times, guard)) return cand;
    }
    // No pinned slot fit (blocked weeks) — fall through to shuffled windows
    // rather than dropping the post.
  }

  for (let dayOffset = 0; dayOffset <= HORIZON_DAYS; dayOffset++) {
    const base = new Date(now);
    base.setDate(base.getDate() + dayOffset);
    for (const hour of shuffled(hours, rand)) {
      const cand = new Date(base);
      cand.setHours(hour, Math.floor(rand() * 60), 0, 0);
      if (cand < earliest) continue;
      if (slotIsFree(cand, times, guard)) return cand;
    }
  }

  // Nothing fit — post in about an hour rather than dropping it.
  return new Date(now.getTime() + 3600_000 + Math.floor(rand() * 21) * 60_000);
}
