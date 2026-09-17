/**
 * Owner-facing voice recap — always grammatical.
 * Never "I'll stay clear of show/be/use/skip/feature …". Leftover infinitives
 * become "I won't …" — do not grow the strip-prefix list.
 */

const DIRECTIVE_PREFIX =
  /^(please\s+)?(do not|don't|never|no more|avoid|skip|stop|no)\s+/i;
const STRIP_LEADING_VERBS = /^(use|show|share|mention|post|include|add)\s+/i;
const WONT_VERBS =
  /^(create|invent|make|sell|shout|post|run|add|include|write|show|share|mention|feature|highlight|focus|put|keep|have|get|go|give|take|bring)\b/i;
const AVOID_GUARD = /^(be|show|use|skip|avoid|don't|do not)(?:\s+|$)/i;
const STAY_CLEAR_LEFTOVER =
  /I'll stay clear of (feature|highlight|focus|show|be|use|skip|put|keep|have|get|go)\b/i;

/** `featuring faces` → `feature faces` so leftover gerunds route to "I won't". */
function stemLeadingGerund(phrase: string): string {
  const m = /^(\w+)ing\b(.*)$/i.exec(phrase);
  if (!m) return phrase;
  const stem = m[1]!.toLowerCase();
  const rest = m[2] ?? "";
  const candidates = [stem, `${stem}e`];
  if (stem.length >= 2 && stem.at(-1) === stem.at(-2)) {
    candidates.push(stem.slice(0, -1));
  }
  for (const c of candidates) {
    if (WONT_VERBS.test(c)) return `${c}${rest}`;
  }
  return phrase;
}

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
  let phrase = stemLeadingGerund(normalizeDontForRecap(raw));
  if (!phrase) return "";
  if (WONT_VERBS.test(phrase)) {
    return `I won't ${phrase}.`;
  }
  while (AVOID_GUARD.test(phrase)) {
    phrase = phrase.replace(AVOID_GUARD, "").trim();
  }
  if (!phrase || /^(show|be|use|skip|avoid)$/i.test(phrase)) return "";
  // After normalize, leftover infinitives still go to "I won't" — never stay-clear-of + verb.
  if (WONT_VERBS.test(phrase)) {
    return `I won't ${phrase}.`;
  }
  const stayClear = `I'll stay clear of ${phrase}.`;
  if (STAY_CLEAR_LEFTOVER.test(stayClear)) {
    return `I won't ${phrase}.`;
  }
  return stayClear;
}

/** Owner-facing voice recap — no dashboard send-off, no "I'll skip use jokes". */
export function voiceRecapSms(tone: string[], donts: string[]): string {
  const toneBit = tone.length ? tone.slice(0, 3).join(", ") : "friendly and direct";
  const avoidBits = donts.slice(0, 2).map(formatDontForRecap).filter(Boolean);
  const avoidBit = avoidBits.length ? ` ${avoidBits.join(" ")}` : "";
  return `Here's how I'm reading your voice: ${toneBit}.${avoidBit}`;
}
