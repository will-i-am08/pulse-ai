/**
 * Worker clocks wake the same inbound brain instead of sending canned menus.
 * Quiet hours and throttle stay in the caller. This never publishes.
 */
import type { Brand } from "@pulse/shared";
import { runGeneralAgent } from "./runGeneralAgent.js";

export const CLOCK_WAKE_PREFIX = "[Clock wake — not an owner message. Do not treat as yes/approval. Do not publish.]";

export function clockFallbackSms(brief: string): string {
  const t = (brief ?? "").trim();
  if (/\b(pending|waiting|draft|sitting)\b/i.test(t)) {
    return "That draft is still sitting with you whenever you want to look.";
  }
  if (/\b(10 days|haven't heard|quiet|stale)\b/i.test(t)) {
    return "Haven't heard from you in a while — send a pic whenever and I'll draft it.";
  }
  return "Anything you want me on this week?";
}

/** True when this turn is a system clock, not owner SMS. */
export function isClockWake(ownerMessage: string | null | undefined): boolean {
  return (ownerMessage ?? "").startsWith("[Clock wake");
}

/**
 * Compose one unsolicited SMS via runGeneralAgent. Caller already passed
 * daytime / throttle. Never dumps yes / change / no.
 */
export async function composeClockSms(brand: Brand, brief: string): Promise<string> {
  const ownerMessage = `${CLOCK_WAKE_PREFIX}\n${brief.trim()}`;
  try {
    const out = await runGeneralAgent({ brand, ownerMessage });
    const reply = (out.reply ?? "").trim();
    if (!reply) return clockFallbackSms(brief);
    if (/\breply yes\b/i.test(reply) && /\b(change|tweak|no to|scrap|discard|bin it)\b/i.test(reply)) {
      return clockFallbackSms(brief);
    }
    return reply;
  } catch (err) {
    console.error(`composeClockSms: brand ${brand.id}`, err);
    return clockFallbackSms(brief);
  }
}
