import { query } from "@pulse/shared";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import { sendToBrand } from "@pulse/gateway";
import { logger } from "../lib/logger.js";
import { isTriggerDue } from "./scheduleCheck.js";
import { runCheckin, getLastInboundAt } from "./checkin.js";
import { runReport } from "./report.js";
import { runReminder, getLastMediaReceivedAt } from "./reminder.js";
import { runAlert, getFailuresSince } from "./alert.js";

async function markSent(triggerId: string): Promise<void> {
  await query(`update proactive_triggers set last_sent_at = $1 where id = $2`, [
    new Date().toISOString(),
    triggerId,
  ]);
}

type TriggerWithBrand = ProactiveTrigger & { brand: Brand | undefined };

async function fetchEnabledTriggers(): Promise<TriggerWithBrand[]> {
  const triggers = await query<ProactiveTrigger>(`select * from proactive_triggers where enabled = $1`, [true]);
  if (triggers.length === 0) return [];

  const brandIds = [...new Set(triggers.map((t) => t.brand_id))];
  const brands = await query<Brand>(`select * from brands where id = any($1::uuid[])`, [brandIds]);
  const brandById = new Map(brands.map((b) => [b.id, b]));

  return triggers.map((t) => ({ ...t, brand: brandById.get(t.brand_id) }));
}

/** Proactive-triggers loop — runs every minute from src/index.ts. */
export async function runTriggerLoop(now: () => Date = () => new Date()): Promise<void> {
  const graph = getGraphAdapter();

  let triggers: TriggerWithBrand[];
  try {
    triggers = await fetchEnabledTriggers();
  } catch (err) {
    logger.error("trigger loop: failed to fetch triggers", { error: String(err) });
    return;
  }

  for (const trigger of triggers) {
    const brand = trigger.brand;
    if (!brand || brand.status !== "active") continue;

    let due: boolean;
    try {
      due = isTriggerDue(trigger.schedule, trigger.last_sent_at, now());
    } catch (err) {
      logger.error(`trigger loop: bad schedule for trigger ${trigger.id}`, { error: String(err) });
      continue;
    }
    if (!due) continue;

    try {
      switch (trigger.kind) {
        case "checkin":
          await runCheckin(brand, trigger, {
            getLastInboundAt,
            sendToBrand,
            markSent,
            now,
          });
          break;
        case "report":
          await runReport(brand, trigger, { graph, sendToBrand, markSent, now });
          break;
        case "reminder":
          await runReminder(brand, trigger, {
            getLastMediaReceivedAt,
            sendToBrand,
            markSent,
            now,
          });
          break;
        case "alert":
          await runAlert(brand, trigger, {
            getFailuresSince,
            sendToBrand,
            markSent,
            now,
          });
          break;
        default:
          logger.warn(`trigger loop: unknown trigger kind '${trigger.kind}' on trigger ${trigger.id}`);
      }
    } catch (err) {
      logger.error(`trigger loop: failed running '${trigger.kind}' for brand ${brand.id}`, { error: String(err) });
    }
  }
}
