import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * LAB-005-carousel timed out inside Lab's 300s after() drain because
 * generatePhotoTextCarousel rendered slides (and the slide-0 double fal)
 * fully sequentially. Keep the parallel path locked in.
 */
describe("generatePhotoTextCarousel Lab budget", () => {
  const formats = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../formats.ts"),
    "utf8",
  );
  const photo = formats.slice(
    formats.indexOf("export async function generatePhotoTextCarousel"),
    formats.indexOf("export async function generateTipCarousel"),
  );

  it("renders the initial photo slides with mapWithConcurrency", () => {
    expect(photo).toMatch(/mapWithConcurrency\(\s*slides,\s*SLIDE_RENDER_CONCURRENCY/);
    expect(photo).not.toMatch(
      /const mediaIds: string\[\] = \[\];\s*for \(let i = 0; i < slides\.length/,
    );
  });

  it("does not auto double-render slide 0 on the first pass", () => {
    expect(photo).not.toMatch(
      /if \(index === 0 && img && !opts\?\.strongerPhoto\)/,
    );
  });
});
