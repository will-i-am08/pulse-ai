/**
 * Cheap similarity gate vs recent outbound SMS.
 * Jaccard on word tokens — regenerate once when too close to a recent out.
 */

const DEFAULT_THRESHOLD = 0.55;

function tokens(s: string): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** Jaccard similarity on word tokens (0..1). */
export function jaccardSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** True when `candidate` is too close to any recent outbound. */
export function tooSimilarToRecent(
  candidate: string,
  recent: string[],
  threshold = DEFAULT_THRESHOLD,
): boolean {
  const c = (candidate ?? "").trim();
  if (!c || !recent.length) return false;
  return recent.some((r) => jaccardSimilarity(c, r) >= threshold);
}

/** Max similarity score vs the recent list. */
export function maxSimilarityToRecent(candidate: string, recent: string[]): number {
  let max = 0;
  for (const r of recent) {
    max = Math.max(max, jaccardSimilarity(candidate, r));
  }
  return max;
}

export const SIMILARITY_THRESHOLD = DEFAULT_THRESHOLD;
