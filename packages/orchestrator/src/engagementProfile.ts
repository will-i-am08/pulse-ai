import {
  query,
  engagementProfileSchema,
  type Brand,
  type BusinessFacts,
  type EngagementProfile,
} from "@pulse/shared";
import { callLLM, stripMarkdown } from "./llm.js";
import type { ProactiveChannel } from "./proactiveBudget.js";

/**
 * The per-owner engagement profile — how proactive, how warm, how often Kip
 * reaches out. This is the answer to "personalisation that varies user to
 * user": content already differs per brand, but temperament didn't.
 *
 * Everything defaults to today's behaviour (balanced / friendly / weekly@8), so
 * an absent profile is a no-op and every existing loop behaves unchanged until
 * an owner moves a dial in plain language ("ease off the check-ins").
 */

/** Parse the stored profile with full defaults. Never throws. */
export function readEngagementProfile(
  brand: Brand | { facts?: BusinessFacts | null },
): EngagementProfile {
  const raw = brand.facts?.engagement_profile;
  const parsed = engagementProfileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : engagementProfileSchema.parse({});
}

// ─── Persona tone modifier ──────────────────────────────────────────────

/** Extra persona lines that lean Kip's tone to the owner's warmth setting. */
export function engagementToneLines(profile: EngagementProfile): string[] {
  switch (profile.warmth) {
    case "crisp":
      return ["This owner prefers it brief and businesslike — get to the point, skip the small talk."];
    case "matey":
      return ["This owner likes it warm and familiar — a bit of banter and personality is welcome."];
    default:
      return []; // friendly = current default, no extra steer
  }
}

// ─── Gating the proactive fleet ─────────────────────────────────────────

/**
 * Should this proactive channel run at all for this owner? `balanced` (the
 * default) returns true everywhere — i.e. exactly today's behaviour.
 */
export function shouldRunProactive(channel: ProactiveChannel, profile: EngagementProfile): boolean {
  // Event follow-up is about the owner's OWN world — always welcome, even for
  // the quiet crowd. Everything else backs off when they've asked for quiet.
  if (channel === "event_followup") return true;
  if (channel === "report") return profile.report.cadence !== "off";
  return profile.proactivity !== "quiet";
}

/** Proactive-outbound budget per 24h for this owner. */
export function proactiveBudgetFor(profile: EngagementProfile): number {
  return profile.proactivity === "high" ? 2 : 1;
}

// ─── Explicit natural-language control ──────────────────────────────────

// Cheap pre-filter so we only spend an LLM call when the owner is plausibly
// telling Kip how to behave, not stating a business fact or asking for a post.
const ENGAGEMENT_SIGNAL =
  /\b(ease off|back off|less often|too much|too many|stop (messaging|texting|checking)|don'?t (message|text|check)|leave me alone|quieter?|chill out|more often|check in|checking in|hit me up|keep me posted|chatty|morning report|daily report|weekly report|report (me|at|every)|proactive|only (message|text) me when|when i (message|text) you)\b/i;

/** Does this message look like it's telling Kip how proactive/warm to be? */
export function looksLikeEngagementPref(body: string | null | undefined): boolean {
  return Boolean(body && ENGAGEMENT_SIGNAL.test(body));
}

interface EngagementDelta {
  proactivity?: EngagementProfile["proactivity"];
  warmth?: EngagementProfile["warmth"];
  report?: { cadence?: EngagementProfile["report"]["cadence"]; hour_local?: number };
  reply?: string;
}

function mergeProfile(current: EngagementProfile, delta: EngagementDelta): EngagementProfile {
  const next: EngagementProfile = {
    ...current,
    report: { ...current.report },
    affinity: { ...current.affinity },
    source: "owner_set",
    updated_at: new Date().toISOString(),
  };
  if (delta.proactivity) next.proactivity = delta.proactivity;
  if (delta.warmth) next.warmth = delta.warmth;
  if (delta.report?.cadence) next.report.cadence = delta.report.cadence;
  if (typeof delta.report?.hour_local === "number") {
    const h = Math.round(delta.report.hour_local);
    if (h >= 0 && h <= 23) next.report.hour_local = h;
  }
  return next;
}

/**
 * Map an owner message to engagement-dial changes and persist them. Returns a
 * short confirmation, or null if the message wasn't about how Kip should
 * behave (so the caller falls through to normal handling).
 */
export async function updateEngagementFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "The owner is telling their social media manager HOW to communicate with them — how proactive, how warm, how often to report. Map it to JSON.",
    'Shape: {"proactivity":"quiet|balanced|high","warmth":"crisp|friendly|matey","report":{"cadence":"off|daily|weekly","hour_local":0-23}}',
    "proactivity: quiet = only speak when spoken to / stop the unprompted check-ins; high = reach out often, stay on top of things; balanced = the sensible middle.",
    "warmth: crisp = brief and businesslike; matey = warm, familiar, a bit of banter; friendly = the default middle.",
    "report: cadence off = no automatic reports; daily/weekly = a rolling report at that cadence. hour_local is the preferred local hour if they name a time.",
    "Include ONLY the fields the message actually changes; omit the rest. If it says nothing about how Kip should behave, output exactly {}.",
    'Also return "reply": one short friendly sentence confirming the change. Wrap as {"changes":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { changes?: EngagementDelta; reply?: string };
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: message }],
      maxTokens: 200,
      task: "engagement-pref",
    });
    const cleaned = stripMarkdown(raw);
    parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const changes = parsed.changes ?? {};
  const validHour =
    typeof changes.report?.hour_local === "number" &&
    changes.report.hour_local >= 0 &&
    changes.report.hour_local <= 23;
  const hasChange =
    changes.proactivity != null ||
    changes.warmth != null ||
    changes.report?.cadence != null ||
    validHour;
  if (!hasChange) return null;

  const current = readEngagementProfile(brand);
  const next = mergeProfile(current, changes);
  await query(
    `update brands
        set facts = jsonb_set(coalesce(facts, '{}'::jsonb), '{engagement_profile}', $2::jsonb, true)
      where id = $1`,
    [brand.id, JSON.stringify(next)],
  );
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  return reply || "Got it — I've tuned how often I'll reach out.";
}
