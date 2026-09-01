import parser from "cron-parser";

/**
 * "Is it due this tick" check: due if the trigger's cron schedule has fired at least once
 * since `lastSentAt` (or has never been sent). Run every minute, so this granularity is fine.
 */
export function isTriggerDue(schedule: string, lastSentAt: string | null, now: Date = new Date()): boolean {
  let prevFire: Date;
  try {
    const interval = parser.parseExpression(schedule, { currentDate: now });
    prevFire = interval.prev().toDate();
  } catch (err) {
    throw new Error(`invalid cron schedule "${schedule}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!lastSentAt) return true;
  return new Date(lastSentAt).getTime() < prevFire.getTime();
}
