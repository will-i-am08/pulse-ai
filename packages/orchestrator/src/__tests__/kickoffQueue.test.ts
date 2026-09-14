import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Brand, Pillar, Post } from "@pulse/shared";

/**
 * State-machine coverage for the kickoff work queue.
 *
 * ~800 lines of claim / reclaim / terminal-write SQL had no tests at all, which
 * is how a batch could be reaped mid-flight and then resurrect itself as `done`.
 * These are SQL-contract tests: the `query`/`queryOne` module is faked and we
 * assert on the statements the queue issues and the order it issues them in.
 */

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: (sql: string, params?: unknown[]) => queryMock(sql, params),
    queryOne: (sql: string, params?: unknown[]) => queryOneMock(sql, params),
  };
});

const ensurePillarsMock = vi.fn();
vi.mock("../pillars.js", () => ({
  ensurePillars: (brandId: string) => ensurePillarsMock(brandId),
}));

const generateFillerPostMock = vi.fn();
vi.mock("../fillers.js", () => ({
  generateFillerPost: (...args: unknown[]) => generateFillerPostMock(...args),
}));

const generateTipCarouselMock = vi.fn();
const generateTypedCarouselMock = vi.fn();
vi.mock("../formats.js", () => ({
  generateTipCarousel: (...args: unknown[]) => generateTipCarouselMock(...args),
  generateTypedCarousel: (...args: unknown[]) => generateTypedCarouselMock(...args),
  // A carousel ask in photo mode is hard-routed here and deliberately does NOT
  // fall through to a filler. A module mock replaces the whole module, so
  // omitting this export left it undefined: every slot threw, the per-slot
  // isolation turned all of them into nulls, and the batch looked like a total
  // failure. Delegating to the filler mock keeps one driver for every route, so
  // each test's failure injection still lands on exactly one slot.
  // This one returns a Design-QA-shaped result: the router only treats it as a
  // draft when `ok === true`, and as a QA failure when `ok === false`. A bare
  // piece (no `ok`) matches neither branch and the slot silently returns null —
  // which looked exactly like a total batch failure. Wrap the shared driver so
  // failure injection (a throw) and null-returns still behave, while satisfying
  // the contract.
  generatePhotoTextCarousel: async (...args: unknown[]) => {
    const piece = await generateFillerPostMock(...args);
    return piece ? { ok: true as const, ...piece } : null;
  },
  // Pure predicate used while routing a slot — must exist for the same reason.
  // Default false: these tests exercise the queue's state machine, not the
  // researched-slides path.
  wantsResearchedIdeaSlides: () => false,
}));

vi.mock("../llm.js", () => ({
  callLLM: vi.fn(async () => "{}"),
  stripMarkdown: (s: string) => s,
}));

import {
  processKickoff,
  runKickoffDrain,
  reclaimStaleKickoffs,
  inferKickoffFromKipCommit,
  clientAskedForContentWork,
  type KickoffDrainResult,
} from "../kickoffs.js";

const BRAND = {
  id: "brand-1",
  name: "Acme",
  visual: { preferred_visuals: "photo" },
} as unknown as Brand;

const PILLAR = { id: "pillar-1", name: "Behind the scenes" } as unknown as Pillar;

function fakePiece(n: number): { post: Post; mediaUrl: string } {
  return {
    post: { id: `post-${n}`, caption: `caption ${n}`, scheduled_at: null } as unknown as Post,
    mediaUrl: `https://cdn.test/${n}.jpg`,
  };
}

/** SQL statements issued via `query`, in order. */
function sqls(): string[] {
  return queryMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());
}
function findSql(re: RegExp): string | undefined {
  return sqls().find((s) => re.test(s));
}

/** Default: claim wins, brand found. */
function primeClaimAndBrand(kind = "first_batch", payload: Record<string, unknown> = {}): void {
  queryOneMock.mockImplementation(async (sql: string) => {
    if (/update kip_kickoffs/.test(sql) && /status = 'queued'/.test(sql)) {
      return { id: "k1", brand_id: BRAND.id, kind, status: "running", payload };
    }
    if (/from brands/.test(sql)) return BRAND;
    return null;
  });
}

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  ensurePillarsMock.mockReset();
  generateFillerPostMock.mockReset();
  generateTipCarouselMock.mockReset();
  generateTypedCarouselMock.mockReset();
  // Any un-primed `query` (heartbeat, markPostOffered, brand visual update,
  // failure-count lookup) resolves to one row so terminal writes look applied.
  queryMock.mockResolvedValue([{ id: "k1", n: 0 }]);
  ensurePillarsMock.mockResolvedValue([PILLAR]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("claimKickoff / terminal writes are compare-and-swap", () => {
  it("bails out when another worker already claimed the row", async () => {
    queryOneMock.mockResolvedValue(null); // claim affected no rows
    const deliver = vi.fn(async () => {});

    await expect(processKickoff("k1", { deliver })).resolves.toEqual([]);

    // No brand lookup, no terminal write, no SMS — the row was not ours.
    expect(queryOneMock).toHaveBeenCalledTimes(1);
    expect(findSql(/status = 'done'/)).toBeUndefined();
    expect(findSql(/status = 'failed'/)).toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("guards finishKickoff on status = 'running' so a reaped row cannot resurrect", async () => {
    primeClaimAndBrand("first_batch", { count: 1 });
    generateFillerPostMock.mockResolvedValue(fakePiece(1));

    await processKickoff("k1", { deliver: async () => {} });

    const finish = findSql(/set status = 'done'/);
    expect(finish).toBeDefined();
    expect(finish).toMatch(/where id = \$1 and status = 'running'/);
    expect(finish).toMatch(/returning id/);
  });

  it("guards failKickoff on status = 'running' too", async () => {
    primeClaimAndBrand("first_batch", { count: 1 });
    generateFillerPostMock.mockResolvedValue(null); // zero drafts -> failure path

    await processKickoff("k1", { deliver: async () => {} });

    const fail = findSql(/set status = 'failed'/);
    expect(fail).toBeDefined();
    expect(fail).toMatch(/where id = \$1 and status = 'running'/);
    expect(fail).toMatch(/returning id/);
  });

  it("reclaim-then-finish: the finish is a no-op and does not erase the failure", async () => {
    primeClaimAndBrand("first_batch", { count: 1 });
    generateFillerPostMock.mockResolvedValue(fakePiece(1));
    // The reaper flipped the row to `failed` while the batch was still running,
    // so the guarded UPDATE matches nothing.
    queryMock.mockImplementation(async (sql: string) => {
      if (/set status = 'done'/.test(sql)) return [];
      return [{ id: "k1", n: 0 }];
    });

    const out = await processKickoff("k1", { deliver: async () => {} });

    // Drafts still returned to the caller — but the row stayed `failed`.
    expect(out).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("finishKickoff skipped"),
      expect.anything(),
    );
  });

  it("heartbeats updated_at from inside the batch so live work is not reaped", async () => {
    primeClaimAndBrand("first_batch", { count: 3 });
    generateFillerPostMock.mockImplementation(async () => fakePiece(1));

    await processKickoff("k1", { deliver: async () => {} });

    const beats = sqls().filter((s) =>
      /update kip_kickoffs set updated_at = now\(\) where id = \$1 and status = 'running'/.test(s),
    );
    expect(beats.length).toBe(3); // one per slot
  });
});

describe("reclaimStaleKickoffs", () => {
  it("ages rows off the heartbeat, not the claim time", async () => {
    queryMock.mockResolvedValue([]);
    await reclaimStaleKickoffs({ now: new Date("2026-09-14T00:00:00.000Z") });
    const sql = findSql(/abandoned running kickoff/);
    expect(sql).toBeDefined();
    expect(sql).toMatch(/greatest\(started_at, updated_at\) < \$1::timestamptz/);
  });
});

describe("partial batch failure is isolated per slot", () => {
  it("one throwing slot degrades the batch instead of aborting it", async () => {
    primeClaimAndBrand("first_batch", { count: 5 });
    let call = 0;
    generateFillerPostMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("image provider 500");
      return fakePiece(call);
    });
    const delivered: KickoffDrainResult[] = [];

    const out = await processKickoff("k1", {
      deliver: async (r) => {
        delivered.push(r);
      },
    });

    // 4 of 5 drafts survive; no apology SMS, no failed row, nothing to retry.
    expect(out).toHaveLength(4);
    expect(delivered).toHaveLength(4);
    expect(delivered.some((r) => /glitched|snag/i.test(r.sms))).toBe(false);
    expect(findSql(/set status = 'done'/)).toBeDefined();
    expect(findSql(/set status = 'failed'/)).toBeUndefined();
  });

  it("does the same for draft_posts", async () => {
    primeClaimAndBrand("draft_posts", { count: 3, visuals: "photo" });
    let call = 0;
    generateFillerPostMock.mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("boom");
      return fakePiece(call);
    });

    const out = await processKickoff("k1", { deliver: async () => {} });

    expect(out).toHaveLength(2);
    expect(findSql(/set status = 'done'/)).toBeDefined();
  });
});

describe("zero-draft runs are recorded as failed", () => {
  it("marks the row failed with a real error string, not done/smsCount: 1", async () => {
    primeClaimAndBrand("first_batch", { count: 3 });
    generateFillerPostMock.mockResolvedValue(null);
    const delivered: KickoffDrainResult[] = [];

    const out = await processKickoff("k1", {
      deliver: async (r) => {
        delivered.push(r);
      },
    });

    expect(findSql(/set status = 'done'/)).toBeUndefined();
    const failCall = queryMock.mock.calls.find((c) => /set status = 'failed'/.test(String(c[0])));
    expect(failCall).toBeDefined();
    expect(String((failCall![1] as unknown[])[1])).toMatch(/every draft slot returned nothing/);

    // The client still hears about it exactly once.
    expect(delivered).toHaveLength(1);
    expect(out[0]?.kickoffFailure).toBeTruthy();
  });

  it("escalates to the operator once a brand keeps drafting nothing", async () => {
    primeClaimAndBrand("draft_posts", { count: 2, visuals: "photo" });
    generateFillerPostMock.mockResolvedValue(null);
    queryMock.mockImplementation(async (sql: string) => {
      if (/count\(\*\)::int as n from kip_kickoffs/.test(sql)) return [{ n: 2 }];
      return [{ id: "k1" }];
    });

    const out = await processKickoff("k1", { deliver: async () => {} });

    expect(out[0]?.operatorAlert).toMatch(/Acme/);
    expect(out[0]?.operatorAlert).toMatch(/3 zero-draft runs/);
  });

  it("stays quiet on a one-off failure", async () => {
    primeClaimAndBrand("draft_posts", { count: 2, visuals: "photo" });
    generateFillerPostMock.mockResolvedValue(null);
    queryMock.mockImplementation(async (sql: string) => {
      if (/count\(\*\)::int as n from kip_kickoffs/.test(sql)) return [{ n: 0 }];
      return [{ id: "k1" }];
    });

    const out = await processKickoff("k1", { deliver: async () => {} });
    expect(out[0]?.operatorAlert).toBeUndefined();
  });
});

describe("errors after the claim never orphan the row", () => {
  it("fails + SMSes when the brand lookup itself throws", async () => {
    queryOneMock.mockImplementation(async (sql: string) => {
      if (/status = 'queued'/.test(sql)) {
        return { id: "k1", brand_id: BRAND.id, kind: "first_batch", status: "running", payload: {} };
      }
      throw new Error("timeout exceeded when trying to connect");
    });
    const delivered: KickoffDrainResult[] = [];

    const out = await processKickoff("k1", {
      deliver: async (r) => {
        delivered.push(r);
      },
    });

    expect(findSql(/set status = 'failed'/)).toBeDefined();
    expect(out).toHaveLength(1);
    expect(delivered[0]?.sms).toMatch(/glitched/i);
    expect(delivered[0]?.brandId).toBe(BRAND.id);
  });

  it("drain keeps going when one row throws out of processKickoff", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/abandoned running kickoff/.test(sql)) return [];
      if (/status = 'queued' order by created_at/.test(sql)) {
        return [{ id: "bad" }, { id: "good" }];
      }
      return [{ id: "good" }];
    });
    queryOneMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/status = 'queued'/.test(sql)) {
        if ((params as string[])?.[0] === "bad") throw new Error("pool exhausted");
        return {
          id: "good",
          brand_id: BRAND.id,
          kind: "draft_posts",
          status: "running",
          payload: { count: 1, visuals: "photo" },
        };
      }
      if (/from brands/.test(sql)) return BRAND;
      return null;
    });
    generateFillerPostMock.mockResolvedValue(fakePiece(1));

    const out = await runKickoffDrain(2, { deliver: async () => {} });

    // The second row was still processed rather than skipped for 20 minutes.
    expect(out).toHaveLength(1);
    expect(out[0]?.brandId).toBe(BRAND.id);
  });
});

describe("inferKickoffFromKipCommit only fires on the client's own ask", () => {
  it("ignores Kip's small talk about posts", () => {
    expect(
      inferKickoffFromKipCommit(
        "how often should I post?",
        "Three a week works nicely — I'll keep your posts spread across the week.",
      ),
    ).toBeNull();
  });

  it("ignores a bare commitment with no work named", () => {
    expect(inferKickoffFromKipCommit("draft me a few posts", "On it.")).toBeNull();
    expect(inferKickoffFromKipCommit("draft me a few posts", "I'll sort it.")).toBeNull();
  });

  it("still fires when the client asked and Kip named the work", () => {
    const r = inferKickoffFromKipCommit(
      "I don't have photos — use generated",
      "Absolutely, I'll pull together the first batch of carousels and get them over for approval.",
    );
    expect(r?.kind).toBe("first_batch");
  });

  it("never fires with no client message at all", () => {
    expect(inferKickoffFromKipCommit(null, "I'll draft a few posts for you now.")).toBeNull();
    expect(inferKickoffFromKipCommit("", "I'll draft a few posts for you now.")).toBeNull();
  });

  it("clientAskedForContentWork rejects bare mentions, accepts real asks", () => {
    expect(clientAskedForContentWork("how often should I post?")).toBe(false);
    expect(clientAskedForContentWork("what do you think of my content?")).toBe(false);
    expect(clientAskedForContentWork("draft me a few posts")).toBe(true);
    expect(clientAskedForContentWork("can you make me a carousel")).toBe(true);
    expect(clientAskedForContentWork("I don't have any photos")).toBe(true);
  });
});
