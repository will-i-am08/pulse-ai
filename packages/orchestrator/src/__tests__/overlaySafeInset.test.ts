import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { overlaySafeInset } from "../imaging.js";

describe("overlaySafeInset", () => {
  it("keeps a generous side buffer on feed widths", () => {
    expect(overlaySafeInset(1080)).toBeGreaterThanOrEqual(140);
    expect(overlaySafeInset(1080)).toBe(Math.round(1080 * 0.14));
    expect(overlaySafeInset(1080)).toBe(151);
    expect(overlaySafeInset(500)).toBe(Math.round(500 * 0.14));
  });

  it("never goes below 64px on small canvases", () => {
    expect(overlaySafeInset(200)).toBe(64);
    expect(Math.round(200 * 0.14)).toBeLessThan(64);
  });

  it("is max(round(width * 0.14), 64) in source", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../imaging.ts"),
      "utf8",
    );
    const fn = src.slice(
      src.indexOf("export function overlaySafeInset"),
      src.indexOf("function overlayFontSize"),
    );
    expect(fn).toMatch(/Math\.max\(Math\.round\(width \* 0\.14\), 64\)/);
  });
});
