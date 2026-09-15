import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../concurrency.js", async () => {
  const actual = await vi.importActual<typeof import("../concurrency.js")>("../concurrency.js");
  return actual;
});

// Lightweight unit coverage for the drain option types + concurrency constant.
import { DRAFT_CONCURRENCY, mapWithConcurrency } from "../concurrency.js";

describe("DRAFT_CONCURRENCY / mapWithConcurrency", () => {
  // Held at 2 deliberately: the shared pg pool is max: 3, so a batch at 3 could
  // own every connection while the per-minute crons wait 30s and then throw.
  it("keeps draft concurrency under the pg pool max", () => {
    expect(DRAFT_CONCURRENCY).toBe(2);
    expect(DRAFT_CONCURRENCY).toBeLessThan(3);
  });

  it("runs work in parallel up to the limit", async () => {
    let live = 0;
    let maxLive = 0;
    const started: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      live++;
      maxLive = Math.max(maxLive, live);
      started.push(n);
      await new Promise((r) => setTimeout(r, 20));
      live--;
      return n * 10;
    }).then((out) => {
      expect(out).toEqual([10, 20, 30, 40]);
    });
    expect(maxLive).toBeLessThanOrEqual(2);
    expect(started.sort()).toEqual([1, 2, 3, 4]);
  });
});
