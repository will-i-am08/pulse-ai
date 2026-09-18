import { query, type Brand, type KipEvent } from "@pulse/shared";
import {
  sendToBrand,
  isDaytime,
  selectDueEvent,
  markEventFollowedUp,
  closeEvents,
  composeEventFollowupSms,
  canSendProactive,
  recordProactiveSend,
} from "./deps.js";
import { readEvents } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

/**
 * Event follow-up — the "how'd the Emily Calder shoot go?" loop.
 *
 * For each active brand with stored events, once an event has clearly passed
 * and we've never asked about it, Kip sends one warm check-in. Guardrails:
 *  - daytime only (retries next tick otherwise);
 *  - shared proactive budget (≤1 unprompted text / brand / 24h);
 *  - one follow-up per event, ever (marked before/at send);
 *  - passed events older than two weeks are retired silently.
 *
 * Gated by KIP_EVENT_FOLLOWUP=on so it can soak on a single brand first.
 */

export function eventFollowupEnabled(env = process.env): boolean {
  return env.KIP_EVENT_FOLLOWUP === "on";
}

export interface EventFollowupDeps {
  listBrandsWithEvents: () => Promise<Brand[]>;
  isDaytime: (now: Date) => boolean;
  canSendProactive: (brandId: string) => Promise<boolean>;
  recordProactiveSend: (brandId: string, ref: string) => Promise<void>;
  compose: (brand: Brand, event: KipEvent) => Promise<string>;
  sendToBrand: (brandId: string, body: string) => Promise<boolean | void>;
  markFollowedUp: (brandId: string, eventId: string, nowISO: string) => Promise<void>;
  closeStale: (brandId: string, ids: string[]) => Promise<void>;
  now: () => Date;
}

/** Testable core — all IO injected. */
export async function runEventFollowup(deps: EventFollowupDeps): Promise<void> {
  const daytime = deps.isDaytime(deps.now());
  const brands = await deps.listBrandsWithEvents();
  for (const brand of brands) {
    try {
      const { due, toClose } = selectDueEvent(readEvents(brand.facts), deps.now());
      if (toClose.length) {
        await deps.closeStale(brand.id, toClose.map((e) => e.id));
      }
      if (!due) continue;
      // Only the SEND is gated by daytime/budget — retiring stale events above
      // is silent bookkeeping and should happen regardless.
      if (!daytime) continue;
      if (!(await deps.canSendProactive(brand.id))) continue;

      const body = await deps.compose(brand, due);
      if (!body || !body.trim()) continue;

      // Mark BEFORE send so a duplicate tick can't double-ask; if the send then
      // throws we accept the rare silent miss over ever texting twice.
      await deps.markFollowedUp(brand.id, due.id, deps.now().toISOString());
      await deps.sendToBrand(brand.id, body);
      await deps.recordProactiveSend(brand.id, due.id);
      logger.info("event follow-up sent", { brandId: brand.id, eventId: due.id, summary: due.summary });
    } catch (err) {
      logger.error("event follow-up failed", {
        brandId: brand.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function listBrandsWithEvents(): Promise<Brand[]> {
  // `facts ? 'kip_events'` is a cheap jsonb key-existence check.
  return query<Brand>(
    `select * from brands
      where status = 'active'
        and facts ? 'kip_events'
      order by updated_at desc nulls last
      limit 500`,
  );
}

/** Wired loop for the worker. */
export async function runEventFollowupLoop(): Promise<void> {
  if (!eventFollowupEnabled()) return;
  await runEventFollowup({
    listBrandsWithEvents,
    isDaytime,
    canSendProactive: (brandId) => canSendProactive(brandId),
    recordProactiveSend: (brandId, ref) => recordProactiveSend(brandId, "event_followup", ref),
    compose: composeEventFollowupSms,
    sendToBrand,
    markFollowedUp: markEventFollowedUp,
    closeStale: closeEvents,
    now: () => new Date(),
  });
}
