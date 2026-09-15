import { describe, expect, it, vi } from "vitest";
import { isRetryableError, withBackoff } from "./backoff.js";

/**
 * Regression pins for retry amplification and wasted retry budget.
 *
 * `TwilioChannel.send` used to retry `messages.create` internally while
 * `sendToBrand` ALSO wrapped it in `withBackoff({retries: 3})`. One client-side
 * timeout became up to six `messages.create` calls — and a timeout does not
 * mean Twilio rejected the send (it commonly accepts and queues, then responds
 * slowly), so each extra attempt was a separately billed, separately delivered
 * duplicate SMS to a paying client.
 *
 * Retry policy now lives in exactly one place: withBackoff.
 */
describe("isRetryableError", () => {
  it("treats permanently-fatal provider 4xx as terminal", () => {
    // 21610 recipient replied STOP, 21614 not SMS-capable, 21617 body too long.
    for (const status of [400, 403, 404, 422]) {
      expect(isRetryableError({ status })).toBe(false);
    }
  });

  it("still retries 429 — rate limiting is transient", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it("retries 5xx and errors with no status (timeouts, socket hangups)", () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });
});

describe("withBackoff retry policy", () => {
  it("stops immediately on a terminal 4xx instead of burning the budget", async () => {
    const err = Object.assign(new Error("Twilio 21610: recipient has opted out"), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withBackoff(fn, { retries: 3, baseDelayMs: 1 })).rejects.toThrow("21610");

    // The whole point: one attempt, not three.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying a rate-limit response", async () => {
    const err = Object.assign(new Error("too many requests"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("sent");

    await expect(withBackoff(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe("sent");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honours an explicit shouldRetry override", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));

    await expect(
      withBackoff(fn, { retries: 3, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
