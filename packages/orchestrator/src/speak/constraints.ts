/**
 * Tiny rotating structural constraints — breaks template attractors on short SMS
 * (same opener / same CTA shape) without changing Kip's persona.
 */

export const STRUCTURAL_CONSTRAINTS = [
  "Do not start with Hi, Hey, Hello, or the owner's name.",
  "Start mid-thought — no greeting opener.",
  "Keep it under 20 words.",
  "Ask at most one question; prefer a statement if a question isn't needed.",
  "Do not end with a question mark unless you truly need an answer.",
  "Lead with the useful bit, not a softener like Sure/Of course/Absolutely.",
  "Use at most one comma. Prefer short sentences.",
  "No exclamation marks this turn.",
  "Sound like a follow-up text, not a fresh cold open.",
  "Skip any 'just checking in' / 'quick nudge' framing.",
] as const;

/** Pick one constraint (optionally seeded for tests). */
export function pickStructuralConstraint(seed?: number): string {
  const i =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed)) % STRUCTURAL_CONSTRAINTS.length
      : Math.floor(Math.random() * STRUCTURAL_CONSTRAINTS.length);
  return STRUCTURAL_CONSTRAINTS[i]!;
}

export function structuralConstraintPromptBlock(seed?: number): string {
  return `Structural constraint for THIS message only: ${pickStructuralConstraint(seed)}`;
}
