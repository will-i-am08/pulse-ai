/**
 * Run async work over items with a fixed concurrency ceiling.
 * Used for carousel slide renders and multi-photo grading (Phase C6).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), items.length);

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** Default concurrency for slide / photo-batch renders. */
export const SLIDE_RENDER_CONCURRENCY = 3;

/**
 * Default concurrency for parallel first-batch / draft-posts generation.
 *
 * Held at 2, NOT 3: the shared pg pool is `max: 3` (packages/shared/src/db.ts)
 * with a 30s connectionTimeoutMillis, and the per-minute publish/trigger/
 * engagement/voice crons plus the 3s linq-inbound and 30s niche-plan loops are
 * competing for the same three connections. At 3 a single draft batch could own
 * the entire pool; losers blocked 30s and then threw. Raising the pool max is
 * the better fix — this is the safe half of it.
 */
export const DRAFT_CONCURRENCY = 2;

/**
 * Lab inbound drain runs in `after()` on the same Vercel function (max 300s).
 * A hung image/LLM slot used to pin the whole batch until the runtime kill,
 * leaving kip_kickoffs `running` with only the first draft offered.
 */
export const DRAFT_SLOT_TIMEOUT_MS = 75_000;

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
