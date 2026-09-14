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
  /**
   * Decide whether an error is worth another attempt. Defaults to
   * `isRetryableError` — permanently-fatal provider errors (HTTP 4xx, e.g.
   * Twilio 21610 STOP / 21614 not-SMS-capable / 21617 body-too-long) are
   * rethrown immediately instead of burning the retry budget.
   */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * True when retrying could plausibly succeed.
 *
 * A 4xx from the provider means the request itself is bad — the recipient has
 * replied STOP, the number can't receive SMS, the body is over 1600 chars.
 * Retrying those three times costs ~1.4s of an already-tight webhook budget and
 * can never succeed. 429 (rate limited) is the one 4xx that IS worth retrying.
 */
export function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return status === 429;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying on rejection with exponential backoff + jitter.
 * Rethrows the last error once `retries` attempts have all failed, or
 * immediately when `shouldRetry` says the error is terminal.
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 200, maxDelayMs = 5000, onRetry, shouldRetry = isRetryableError } = opts;
  const attempts = Math.max(1, retries);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      if (!shouldRetry(err)) break;
      onRetry?.(err, attempt);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = delay * 0.2 * Math.random();
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}
