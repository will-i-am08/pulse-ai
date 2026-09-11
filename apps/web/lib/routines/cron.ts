/**
 * Small cron helpers for the Routines UI. Routines are stored as
 * `proactive_triggers.schedule` cron strings and evaluated by the worker
 * with cron-parser. We only ever *build* the two shapes the UI offers
 * (daily / weekly at a time), so the strings are always valid; `describeCron`
 * turns any stored expression back into plain English, falling back to the
 * raw string for shapes we didn't author.
 */

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Cadence = 'daily' | 'weekly';

/** Build a `M H * * [D]` cron from the structured routine form. */
export function buildCron(cadence: Cadence, dow: number, time: string): string {
  const [hh, mm] = time.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) {
    throw new Error('bad time');
  }
  if (cadence === 'daily') return `${m} ${h} * * *`;
  const d = Number(dow);
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('bad day');
  return `${m} ${h} * * ${d}`;
}

function fmtTime(h: number, m: number): string {
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Turn a stored cron string into plain English (best-effort). */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dowRaw] = parts;
  const m = Number(min);
  const h = Number(hour);
  if (!Number.isInteger(m) || !Number.isInteger(h) || dom !== '*' || mon !== '*') return expr;

  if (dowRaw === '*') return `Daily · ${fmtTime(h, m)}`;
  const d = Number(dowRaw);
  if (Number.isInteger(d) && d >= 0 && d <= 6) return `${DOW[d]}s · ${fmtTime(h, m)}`;
  return expr;
}
