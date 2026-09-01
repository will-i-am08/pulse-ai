import { describe, expect, it, vi } from "vitest";
import { withBackoff } from "./backoff.js";

describe("withBackoff", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withBackoff(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns the result once it succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom again"))
      .mockResolvedValueOnce("recovered");
    const onRetry = vi.fn();

    const result = await withBackoff(fn, { retries: 3, baseDelayMs: 1, onRetry });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("throws the last error once retries are exhausted", async () => {
    const err = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withBackoff(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
