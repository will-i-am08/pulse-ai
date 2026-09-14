import { describe, it, expect } from "vitest";
import { overlaySafeInset } from "../imaging.js";

describe("overlaySafeInset", () => {
  it("keeps a generous side buffer on feed widths", () => {
    expect(overlaySafeInset(1080)).toBeGreaterThanOrEqual(110);
    expect(overlaySafeInset(1080)).toBeLessThanOrEqual(140);
  });

  it("never goes below 48px on small canvases", () => {
    expect(overlaySafeInset(200)).toBe(48);
  });
});
