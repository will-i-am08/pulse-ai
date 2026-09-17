/**
 * Owner-facing voice recap — always grammatical.
 * Never "I'll stay clear of show/be/use/skip …".
 */

const DIRECTIVE_PREFIX =
  /^(please\s+)?(do not|don't|never|no more|avoid|skip|stop|no)\s+/i;
const STRIP_LEADING_VERBS = /^(use|show|share|mention|post|include|add)\s+/i;
const WONT_VERBS =
  /^(create|invent|make|sell|shout|post|run|add|include|write|show|share|mention)\b/i;
const AVOID_GUARD = /^(be|show|use|skip|avoid|don't|do not)(?:\s+|$)/i;

/** Strip directive prefixes and leading action verbs; rewrite `be X` → `X tone`. */
export function normalizeDontForRecap(raw: string): string {
  let s = raw.replace(/;/g, ",").trim();
  let prev = "";
  while (s && s !== prev) {
    prev = s;
    s = s.replace(DIRECTIVE_PREFIX, "").trim();
  }
  prev = "";
  while (s && s !== prev) {
    prev = s;
    s = s.replace(STRIP_LEADING_VERBS, "").trim();
  }
  if (/^be\s+/i.test(s)) {
    s = s.replace(/^be\s+/i, "").trim();
    if (s && !/\btone\b/i.test(s)) s = `${s} tone`;
  }
  s = s.replace(/\.+$/, "");
  return s.toLowerCase().trim();
}

/** One recap sentence. Verb-led leftovers become "I won't"; otherwise "I'll stay clear of". */
export function formatDontForRecap(raw: string): string {
  let phrase = normalizeDontForRecap(raw);
  if (!phrase) return "";
  if (WONT_VERBS.test(phrase)) {
    return `I won't ${phrase}.`;
  }
  while (AVOID_GUARD.test(phrase)) {
    phrase = phrase.replace(AVOID_GUARD, "").trim();
  }
  if (!phrase || /^(show|be|use|skip|avoid)$/i.test(phrase)) return "";
  return `I'll stay clear of ${phrase}.`;
}

/** Owner-facing voice recap — no dashboard send-off, no "I'll skip use jokes". */
export function voiceRecapSms(tone: string[], donts: string[]): string {
  const toneBit = tone.length ? tone.slice(0, 3).join(", ") : "friendly and direct";
  const avoidBits = donts.slice(0, 2).map(formatDontForRecap).filter(Boolean);
  const avoidBit = avoidBits.length ? ` ${avoidBits.join(" ")}` : "";
  return `Here's how I'm reading your voice: ${toneBit}.${avoidBit}`;
}
