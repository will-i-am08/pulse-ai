/** App timezone for owner-facing "what day is it" (stands in for brand TZ). */
export function appTz(): string {
  return process.env.TZ || "Australia/Sydney";
}

/**
 * Format a scheduled slot like "Tue 7:00 pm" in the process timezone.
 * Schedule slots are written with Date#setHours in that same zone (see scheduler),
 * so labels stay consistent with stored scheduled_at values.
 */
export function formatScheduledSlot(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Short weekday like "Tue" in the process timezone. */
export function formatWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(d);
}

/** Local YYYY-MM-DD (en-CA) so day buckets follow the process timezone, not UTC. */
export function localYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Full local clock for agent prompts, e.g. "Friday, 18 Sep 2026, 1:11 pm".
 * Always uses Australia/Sydney (or TZ) so Kip does not guess the weekday from
 * UTC while the owner is already on the next local calendar day.
 */
export function formatLocalClock(d: Date = new Date(), tz: string = appTz()): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** One system-prompt line: authoritative local clock, never invent the day. */
export function localClockPromptLine(d: Date = new Date(), tz: string = appTz()): string {
  return `Local clock right now: ${formatLocalClock(d, tz)} (${tz}). Use this for any day-of-week or "today" reasoning — never guess the date.`;
}

/**
 * Owner-facing "going out …" fragment. Past or due-within-a-minute slots say
 * "now" so we never announce yesterday's weekday on a later day
 * (e.g. "Thu 1:21 pm" on Friday).
 */
export function formatGoingOutWhen(
  scheduledAt: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (scheduledAt == null || scheduledAt === "") return "soon";
  const d = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  if (!Number.isFinite(d.getTime())) return "soon";
  if (d.getTime() <= now.getTime() + 60_000) return "now";
  return formatScheduledSlot(d);
}

/** "Tue", "Tue and Thu", "Mon, Wed, and Fri". */
export function joinEnglish(items: string[]): string {
  const parts = items.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
