import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../concurrency.js", async () => {
  const actual = await vi.importActual<typeof import("../concurrency.js")>("../concurrency.js");
  return actual;
});

// Lightweight unit coverage for the drain option types + concurrency constant.
import { DRAFT_CONCURRENCY, mapWithConcurrency, withTimeout, raceTimeout } from "../concurrency.js";

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

describe("withTimeout", () => {
  it("resolves when the work finishes first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "fast")).resolves.toBe("ok");
  });

  it("rejects when the work hangs past the deadline", async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, "draft_posts slot 2"),
    ).rejects.toThrow(/draft_posts slot 2 timed out after 20ms/);
  });
});

describe("raceTimeout", () => {
  it("resolves ok when the work finishes first", async () => {
    await expect(raceTimeout(Promise.resolve("ok"), 50, "fast")).resolves.toEqual({
      ok: true,
      value: "ok",
    });
  });

  it("returns { ok: false, work } on timeout and the original work still fulfills", async () => {
    const work = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 80));
    const raced = await raceTimeout(work, 30, "slow slot");
    expect(raced.ok).toBe(false);
    if (raced.ok) throw new Error("expected timeout");
    expect(raced.work).toBe(work);
    await expect(raced.work).resolves.toBe("done");
  });

  it("rethrows non-timeout rejection", async () => {
    await expect(raceTimeout(Promise.reject(new Error("boom")), 50, "err")).rejects.toThrow("boom");
  });
});

function sliceKickoffFn(src: string, fnName: "runDraftPosts" | "runFirstBatch"): string {
  const start = src.indexOf(`async function ${fnName}`);
  const next = src.indexOf("\nasync function ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("runDraftPosts / runFirstBatch timeout recovery (source pin)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../kickoffs.ts"), "utf8");

  it("stashes pending work and awaits it before zeroDraftFailure", () => {
    for (const fnName of ["runDraftPosts", "runFirstBatch"] as const) {
      const fn = sliceKickoffFn(src, fnName);
      expect(fn).toMatch(/const work = draftGeneratedPiece\(/);
      expect(fn).toMatch(/raceTimeout\(work, DRAFT_SLOT_TIMEOUT_MS/);
      expect(fn).toMatch(/pending\.push\(\{ work/);
      const pendingWait = fn.indexOf("awaitPendingDraftWork");
      const recover = fn.indexOf("recoverRecentKickoffPosts");
      const fail =
        fnName === "runDraftPosts"
          ? fn.indexOf("Couldn't finish those drafts just then")
          : fn.indexOf("Hit a snag drafting that first batch");
      expect(pendingWait).toBeGreaterThan(-1);
      expect(recover).toBeGreaterThan(pendingWait);
      expect(fail).toBeGreaterThan(recover);
    }
  });

  it("always awaits timed-out siblings after the map, even when some slots succeeded", () => {
    for (const fnName of ["runDraftPosts", "runFirstBatch"] as const) {
      const fn = sliceKickoffFn(src, fnName);
      expect(fn, fnName).not.toMatch(/if\s*\(\s*!out\.length\s*&&\s*pending/);
      expect(fn, fnName).toMatch(/if\s*\(\s*pending\.length\s*>\s*0\s*\)/);
      const afterMap = fn.slice(fn.indexOf("let outcomes"));
      const pendingWait = afterMap.indexOf("awaitPendingDraftWork");
      const emptyOut = afterMap.indexOf("if (!out.length)");
      expect(pendingWait, fnName).toBeGreaterThan(-1);
      expect(emptyOut, `${fnName} must await pending BEFORE if (!out.length)`).toBeGreaterThan(
        pendingWait,
      );
    }
  });

  it("fail SMS is not the first response after a slot timeout", () => {
    const fail = "Couldn't finish those drafts just then — try again in a moment?";
    const firstBatchFail = "Hit a snag drafting that first batch";
    for (const fnName of ["runDraftPosts", "runFirstBatch"] as const) {
      const fn = sliceKickoffFn(src, fnName);
      expect(fn).toMatch(/if \(!raced\.ok\) \{[\s\S]*?pending\.push[\s\S]*?return null;/);
      const timeoutReturn = fn.indexOf("pending.push");
      const pendingWait = fn.indexOf("awaitPendingDraftWork");
      const recover = fn.indexOf("recoverRecentKickoffPosts");
      const failAt = fnName === "runDraftPosts" ? fn.indexOf(fail) : fn.indexOf(firstBatchFail);
      expect(timeoutReturn).toBeGreaterThan(-1);
      expect(pendingWait).toBeGreaterThan(timeoutReturn);
      expect(recover).toBeGreaterThan(pendingWait);
      expect(failAt).toBeGreaterThan(recover);
    }
    expect(src).toMatch(/status in \('pending_approval', 'draft'\)/);
    expect(src.indexOf("async function recoverRecentKickoffPosts")).toBeLessThan(src.indexOf(fail));
  });

  it("recover skips posts without media_ids and cannot throw into the fail SMS", () => {
    const start = src.indexOf("async function recoverRecentKickoffPosts");
    const recover = src.slice(start, src.indexOf("\nasync function ", start + 1));
    expect(recover).toMatch(/media_ids \?\? \[\]/);
    expect(recover).toMatch(/if \(!mediaIds\.length\) continue/);
    for (const fnName of ["runDraftPosts", "runFirstBatch"] as const) {
      const fn = sliceKickoffFn(src, fnName);
      expect(fn, fnName).toMatch(/try \{[\s\S]*recoverRecentKickoffPosts[\s\S]*\} catch/);
    }
  });
});
