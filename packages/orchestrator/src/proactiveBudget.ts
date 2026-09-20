import { query, queryOne } from "@pulse/shared";

/**
 * One proactive budget for every loop that TEXTS the owner unprompted.
 *
 * The danger with proactiveness is a muted number: several loops each deciding
 * to reach out "once a day" add up to spam. So every proactive outbound is
 * ledgered in `proactive_sends`, and a loop asks `canSendProactive` before it
 * composes anything. Default budget: at most one proactive text per brand per
 * 24h (the "balanced" setting — Phase 2's engagement profile will widen or
 * narrow this per owner).
 *
 * To avoid a risky rewrite of every existing loop in one go, the budget also
 * counts recent proactive KICKOFFS (autonomy's trend/competitor drafts) so the
 * two systems don't double up. Existing SMS loops (checkin/report/competitor)
 * migrate to `recordProactiveSend` in Phase 2; until then they keep their own
 * cadence guards and this budget simply governs the new channels.
 */

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_LIMIT = 1;

export type ProactiveChannel =
  | "event_followup"
  | "checkin"
  | "report"
  | "competitor"
  | "autonomy";

export interface ProactiveBudgetOpts {
  /** Max proactive outbounds allowed in the window. Default 1. */
  limit?: number;
  /** Rolling window in hours. Default 24. */
  windowHours?: number;
}

/**
 * True when the brand is under its proactive budget for the window. Counts both
 * ledgered proactive sends and recent proactive kickoffs.
 */
export async function canSendProactive(
  brandId: string,
  opts: ProactiveBudgetOpts = {},
): Promise<boolean> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const row = await queryOne<{ n: number }>(
    `select
       (
         (select count(*) from proactive_sends
            where brand_id = $1
              and sent_at > now() - ($2::text || ' hours')::interval)
         +
         (select count(*) from kip_kickoffs
            where brand_id = $1
              and reason = 'proactive'
              and created_at > now() - ($2::text || ' hours')::interval)
       )::int as n`,
    [brandId, String(windowHours)],
  );
  return Number(row?.n ?? 0) < limit;
}

/** Ledger a proactive outbound so it counts against the budget. */
export async function recordProactiveSend(
  brandId: string,
  channel: ProactiveChannel,
  ref?: string | null,
): Promise<void> {
  await query(
    `insert into proactive_sends (brand_id, channel, ref) values ($1, $2, $3)`,
    [brandId, channel, ref ?? null],
  );
}
