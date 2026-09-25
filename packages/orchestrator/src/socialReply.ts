import type { Brand } from "@pulse/shared";
import { looksLikeAffirmation, looksLikeGreeting } from "./classify.js";
import { ownerFirstName } from "./persona.js";
import type { Actionable } from "./reengagement.js";

function pick<T>(items: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 2147483647;
  return items[Math.abs(h) % items.length]!;
}

function gapClause(phrase: string): string {
  const p = (phrase ?? "").trim();
  if (!p) return "it's been a bit";
  if (/^it'?s been\b/i.test(p)) return p;
  return `we last spoke ${p}`;
}

/**
 * Instant SMS for a whole-message hi / thanks / vibe. No LLM.
 * Null when the inbound isn't a social beat (caller should speak).
 *
 * Phase A: inbound no longer owns hi/thanks with these canned lines —
 * leftover turns go to the agent (or converse). Kept for tests / callers
 * that still want a local social beat.
 */
export function quickSocialReply(brand: Brand, inbound: string): string | null {
  const t = (inbound ?? "").trim();
  if (!t) return null;
  const name = ownerFirstName(brand);
  const seed = `${brand.id}:${t.toLowerCase()}`;

  if (/^(thanks?|thank you|cheers|ta)\b/i.test(t) && looksLikeGreeting(t)) {
    return name
      ? pick([`Anytime, ${name}.`, `No worries, ${name}.`, `Anytime.`], seed)
      : pick(["Anytime.", "No worries."], seed);
  }
  if (looksLikeAffirmation(t) || /^(nice one|good stuff|legend)\b/i.test(t)) {
    return name
      ? pick([`Nice one, ${name}.`, `Love that.`, `Legend.`], seed)
      : pick(["Nice one.", "Love that."], seed);
  }
  if (/^(hey|hi|hello|yo|hiya|heya|howdy|hallo|sup|wassup)\b/i.test(t) && looksLikeGreeting(t)) {
    return name ? pick([`Hey ${name}!`, `Hey ${name}.`, `Hi ${name}!`], seed) : pick(["Hey!", "Hey hey."], seed);
  }
  if (looksLikeGreeting(t)) {
    return name
      ? pick([`Hey ${name}, all good here.`, `Hey ${name} — I'm around.`], seed)
      : pick(["Hey, all good here.", "Hey — I'm around."], seed);
  }
  return null;
}

/** Come-back-after-a-gap social beat — still no LLM. */
export function quickReengageReply(
  brand: Brand,
  inbound: string,
  phrase: string,
  actionable: Actionable | null,
): string | null {
  if (!looksLikeGreeting(inbound) && !looksLikeAffirmation(inbound)) return null;
  const name = ownerFirstName(brand);
  const hey = name ? `Hey ${name}` : "Hey";
  const gap = gapClause(phrase);
  if (actionable?.summary) {
    return `${hey}, ${gap}. Still got ${actionable.summary} if you want to pick it up.`;
  }
  return `${hey}, ${gap}. I'm around whenever you want to post something.`;
}
