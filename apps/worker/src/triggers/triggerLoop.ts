import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@pulse/shared";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import { sendToBrand } from "@pulse/gateway";
import { logger } from "../lib/logger.js";
import { isTriggerDue } from "./scheduleCheck.js";
import { runCheckin, getLastInboundAt } from "./checkin.js";
import { runReport } from "./report.js";
import { runReminder, getLastMediaReceivedAt } from "./reminder.js";
import { runAlert, getFailuresSince } from "./alert.js";

async function markSent(supabase: SupabaseClient, triggerId: string): Promise<void> {
  const { error } = await supabase
    .from("proactive_triggers")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("id", triggerId);
  if (error) throw new Error(`markSent failed: ${error.message}`);
}

type TriggerWithBrand = ProactiveTrigger & { brands: Brand };

async function fetchEnabledTriggers(supabase: SupabaseClient): Promise<TriggerWithBrand[]> {
  const { data, error } = await supabase.from("proactive_triggers").select("*, brands(*)").eq("enabled", true);
  if (error) throw new Error(`fetchEnabledTriggers failed: ${error.message}`);
  return (data ?? []) as TriggerWithBrand[];
}

/** Proactive-triggers loop — runs every minute from src/index.ts. */
export async function runTriggerLoop(now: () => Date = () => new Date()): Promise<void> {
  const supabase = serviceClient();
  const graph = getGraphAdapter();

  let triggers: TriggerWithBrand[];
  try {
    triggers = await fetchEnabledTriggers(supabase);
  } catch (err) {
    logger.error("trigger loop: failed to fetch triggers", { error: String(err) });
    return;
  }

  for (const trigger of triggers) {
    const brand = trigger.brands;
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
            getLastInboundAt: (brandId) => getLastInboundAt(supabase, brandId),
            sendToBrand,
            markSent: (id) => markSent(supabase, id),
            now,
          });
          break;
        case "report":
          await runReport(brand, trigger, { supabase, graph, sendToBrand, markSent: (id) => markSent(supabase, id), now });
          break;
        case "reminder":
          await runReminder(brand, trigger, {
            getLastMediaReceivedAt: (brandId) => getLastMediaReceivedAt(supabase, brandId),
            sendToBrand,
            markSent: (id) => markSent(supabase, id),
            now,
          });
          break;
        case "alert":
          await runAlert(brand, trigger, {
            getFailuresSince: (brandId, since) => getFailuresSince(supabase, brandId, since),
            sendToBrand,
            markSent: (id) => markSent(supabase, id),
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
