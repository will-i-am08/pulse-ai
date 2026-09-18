/**
 * Classify orchestrator failures so the gateway can pick an owner SMS that
 * does not ask them to resend the same broken ask in a loop.
 */

export type InboundFailureClass = "config" | "transient" | "unknown";

const CONFIG_RE =
  /Invalid time zone|RangeError|is not a valid|ENV|environment|misconfigured|Cannot find module/i;

const TRANSIENT_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|connection terminated|Connection terminated|too many clients|TimeoutError|socket hang up|fetch failed|Neon|Client has encountered a connection error|Connection refused|temporarily unavailable|503|502|429/i;

export function classifyInboundFailure(err: unknown): InboundFailureClass {
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : String(err);
  if (CONFIG_RE.test(msg)) return "config";
  if (TRANSIENT_RE.test(msg)) return "transient";
  return "unknown";
}

/** Sticky / programming failures — do not ask the owner to send the same text again. */
export const INBOUND_FAILURE_SMS_CONFIG =
  "Hit a snag on my side just then — hang tight, I'll catch the next one.";

/** Ambiguous / one-off failures — soft ask to retry once. */
export const INBOUND_FAILURE_SMS_RETRY =
  "Ah — that one glitched on my side. Mind sending it again?";

export function inboundFailureOwnerSms(cls: InboundFailureClass): string {
  return cls === "config" ? INBOUND_FAILURE_SMS_CONFIG : INBOUND_FAILURE_SMS_RETRY;
}

/** In-process cooldown so sticky bugs cannot spam identical glitch SMS. */
const lastGlitchSmsAt = new Map<string, number>();
export const GLITCH_SMS_COOLDOWN_MS = 120_000;

export function shouldSendGlitchSms(brandId: string, now = Date.now()): boolean {
  const prev = lastGlitchSmsAt.get(brandId) ?? 0;
  if (now - prev < GLITCH_SMS_COOLDOWN_MS) return false;
  lastGlitchSmsAt.set(brandId, now);
  return true;
}

/** Test helper — clear cooldown state between cases. */
export function resetGlitchSmsCooldown(): void {
  lastGlitchSmsAt.clear();
}
