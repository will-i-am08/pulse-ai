/**
 * Gap-fill "draft one" asks (reply to a nudge) — must NOT match carousel /
 * photo kickoffs like "can you make me a carousel…".
 */
export const DRAFT_FILLER_RE =
  /\b((draft|write|make|create)\s+(one|it|a\s+post|something)|(you\s+)?(draft|write)\s+(one|it|a\s+post|something)|draft\s+one)\b/i;

/** True when the SMS is a gap-fill "draft one" ask (not a carousel/photo kickoff). */
export function looksLikeGapFillDraftAsk(body: string): boolean {
  return DRAFT_FILLER_RE.test(body);
}
