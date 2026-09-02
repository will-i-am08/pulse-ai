// Small retry-with-backoff helper. Every external call (Graph API, Neon) in this
// package goes through here so failures never fail silently or retry forever.

export interface RetryOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 5000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      const delay =
        Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[graph:retry] ${label} failed (attempt ${attempt}/${attempts}): ${message}. Retrying in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
