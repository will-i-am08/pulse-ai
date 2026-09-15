import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const isDaytimeMock = vi.fn();
const sendToBrandMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("../proactive/deps.js", () => ({
  isDaytime: (...args: unknown[]) => isDaytimeMock(...args),
  sendToBrand: (...args: unknown[]) => sendToBrandMock(...args),
  gapNudgeMessage: vi.fn(async () => "nudge"),
  chooseNextFormat: vi.fn(async () => "post"),
  pickFreshPhoto: vi.fn(async () => null),
  pickFreshPhotos: vi.fn(async () => []),
  draftPostFromPhoto: vi.fn(async () => null),
  draftCarouselFromPhotos: vi.fn(async () => null),
  draftStoryFromPhoto: vi.fn(async () => null),
  draftReelFromStills: vi.fn(async () => ({ ok: false })),
  videoEditFallbackSms: vi.fn(() => "fallback"),
  generateTipCarousel: vi.fn(async () => null),
  generateTypedCarousel: vi.fn(async () => null),
}));

// Declared with a rest parameter so the recorded calls keep their arguments:
// with `async () => …` the mock types as zero-arity, `mock.calls[0]` is an empty
// tuple, and asserting on the SQL it was called with does not compile.
const queryMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const queryOneMock = vi.fn(async (..._args: unknown[]) => null);
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: (...args: unknown[]) => queryMock(...(args as [])),
    queryOne: (...args: unknown[]) => queryOneMock(...(args as [])),
  };
});

import { runGapFillLoop } from "../proactive/gapFill.js";

beforeEach(() => {
  isDaytimeMock.mockReset();
  sendToBrandMock.mockReset();
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  queryOneMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runGapFillLoop quiet hours", () => {
  it("does nothing at night — no brand query, no SMS", async () => {
    isDaytimeMock.mockReturnValue(false);

    await runGapFillLoop();

    // Bails before it even looks at brands: a 2am Railway redeploy fires this
    // loop 20s later (runSoonMs), and sendToBrand has no quiet-hours check of
    // its own, so this gate is the only thing protecting paying clients.
    expect(queryMock).not.toHaveBeenCalled();
    expect(sendToBrandMock).not.toHaveBeenCalled();
  });

  it("runs during the day", async () => {
    isDaytimeMock.mockReturnValue(true);

    await runGapFillLoop();

    expect(queryMock).toHaveBeenCalled();
    expect(String(queryMock.mock.calls[0]![0])).toMatch(/from brands/);
  });
});

/**
 * Regression net for the whole family: every proactive loop that sends a brand
 * an SMS nobody asked for must gate on isDaytime. gapFill was the one that
 * didn't, and there was nothing to catch it.
 */
describe("unsolicited proactive loops gate on isDaytime", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const proactiveDir = join(here, "..", "proactive");

  const MUST_GATE = [
    "gapFill.ts",
    "chase.ts",
    "connectNudge.ts",
    "competitorWatch.ts",
    "weeklyDigest.ts",
    "autonomyLoop.ts",
  ];

  it.each(MUST_GATE)("%s calls isDaytime", (file) => {
    const src = readFileSync(join(proactiveDir, file), "utf8");
    expect(src).toMatch(/isDaytime\(/);
  });

  it("keeps the list honest — every file above still exists", () => {
    const present = readdirSync(proactiveDir);
    for (const f of MUST_GATE) expect(present).toContain(f);
  });
});
