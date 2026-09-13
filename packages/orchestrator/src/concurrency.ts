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

/** Default concurrency for parallel first-batch / draft-posts generation. */
export const DRAFT_CONCURRENCY = 3;
