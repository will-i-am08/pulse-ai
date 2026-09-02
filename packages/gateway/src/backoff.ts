// Small retry-with-backoff helper for wrapping flaky external calls
// (Twilio send, media fetch, putMedia, ...). Exponential
// delay with jitter; never retries indefinitely.

export interface BackoffOptions {
  /** Total number of attempts, including the first. Default 3. */
  retries?: number;
  /** Base delay in ms before the first retry. Default 200. */
  baseDelayMs?: number;
  /** Upper bound on the delay between attempts. Default 5000. */
  maxDelayMs?: number;
  /** Called before each retry (not called after the final failed attempt). */
  onRetry?: (error: unknown, attempt: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying on rejection with exponential backoff + jitter.
 * Rethrows the last error once `retries` attempts have all failed.
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 200, maxDelayMs = 5000, onRetry } = opts;
  const attempts = Math.max(1, retries);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      onRetry?.(err, attempt);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = delay * 0.2 * Math.random();
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}
