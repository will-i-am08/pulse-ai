/**
 * Detect whether freeform owner text wants a carousel vs a single feed graphic.
 * Negations like "not a carousel" / "one square graphic" must win (LAB-004).
 */

export function textWantsCarousel(body: string | null | undefined): boolean {
  const t = (body ?? "").trim();
  if (!t) return false;
  if (
    /\bnot\s+(?:a\s+|an\s+)?carr?ousel\b/i.test(t) ||
    /\b(?:no|without|skip)\s+carr?ousels?\b/i.test(t) ||
    /\b(?:single|one)\s+(?:square\s+)?(?:graphic|image|post|feed)\b/i.test(t) ||
    /\bsquare\s+graphic\b/i.test(t) ||
    /\bfeed\s+image\b/i.test(t) ||
    /\bnot\s+(?:a\s+)?(?:carousel|multi[- ]?photo|swipeable)\b/i.test(t)
  ) {
    return false;
  }
  return /\b(carr?ousels?|swipe(?:able)?|multi[- ]?photos?)\b/i.test(t);
}
