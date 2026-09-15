import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetServerEnvCache } from "@pulse/shared";
import {
  buildMotionInput,
  buildStillInput,
  clampDurationForFamily,
  familyAcceptsImageRefs,
  namedImageSize,
  normaliseMotionSeconds,
  wanFramesForSeconds,
} from "../ugc/modelRouter.js";
import { escapeDrawtext, captionSchedule } from "../ugc/assemble.js";
import { looksLikeUgcRetune, scoreUgcAudioHeuristic, MAX_SCRIPT_WORDS } from "../ugc/score.js";
import { ugcActualCostCents } from "../ugc/pipeline.js";
import { routeAiVideo, staleAiVideoMinutes, _resetAiVideoEnvCache } from "../aiVideo.js";

// ── finding 7: an apostrophe used to destroy the job after everything was paid for ──

describe("ffmpeg drawtext escaping (finding 7)", () => {
  it("does not leave the quoted section open on an apostrophe", () => {
    // Inside drawtext=text='...' a backslash is NOT an escape. The only portable
    // idiom is close-quote / escaped-quote / reopen.
    expect(escapeDrawtext("don't")).toBe("don'\\''t");
    expect(escapeDrawtext("don't")).not.toContain("\\'t");
  });

  it("keeps the quote count balanced so the filtergraph still parses", () => {
    const filter = `text='${escapeDrawtext("it's here, y'all")}'`;
    const quotes = (filter.match(/'/g) ?? []).length;
    expect(quotes % 2).toBe(0);
  });

  it("leaves colons alone — quoting already protects them", () => {
    // The old code emitted "\:" which rendered a literal backslash on screen.
    expect(escapeDrawtext("ready: today")).toBe("ready: today");
  });

  it("still escapes backslashes and flattens newlines", () => {
    expect(escapeDrawtext("a\\b")).toBe("a\\\\b");
    expect(escapeDrawtext("one\ntwo")).toBe("one two");
  });

  it("handles the casual fragmented speech the script prompt asks for", () => {
    // NOT a parity check. The correct ffmpeg idiom is close-quote / escaped
    // quote / reopen (`'\''`), which emits THREE apostrophes per literal one —
    // so `text='...'` holds 2 + 3n of them and is odd whenever n is odd. An
    // even-count assertion fails on correct output. What actually matters is
    // that every apostrophe is emitted as that idiom and none is left bare
    // inside the quoted section (a bare one closes the string early and
    // corrupts the filtergraph — the bug this pins).
    const cases: Array<[string, string]> = [
      ["I'm obsessed", "I'\\''m obsessed"],
      ["you'll see", "you'\\''ll see"],
      ["that's it — don't skip", "that'\\''s it — don'\\''t skip"],
    ];
    for (const [input, expected] of cases) {
      const out = escapeDrawtext(input);
      expect(out).toBe(expected);
      // No apostrophe survives un-escaped: every one is part of the `'\''` run.
      expect(out.replace(/'\\''/g, "")).not.toContain("'");
    }
  });
});

// ── finding 8: captions were timed against nothing; the VO got truncated ──

describe("caption schedule (finding 8)", () => {
  it("fits every chunk inside the real duration", () => {
    const slots = captionSchedule(6, 12);
    expect(slots).toHaveLength(6);
    expect(slots[slots.length - 1]!.end).toBeLessThanOrEqual(12);
  });

  it("never schedules past the end of the video (the old 2.2s cadence did)", () => {
    // 24 chunks x 2.2s = 52.8s of captions on a 12s video under the old code.
    const slots = captionSchedule(24, 12);
    for (const s of slots) expect(s.end).toBeLessThanOrEqual(12.0001);
  });

  it("drops chunks that cannot get a readable slot rather than hiding them", () => {
    const slots = captionSchedule(24, 12);
    expect(slots.length).toBeLessThan(24);
    for (const s of slots) expect(s.end - s.start).toBeGreaterThanOrEqual(0.49);
  });

  it("is empty for degenerate input", () => {
    expect(captionSchedule(0, 12)).toEqual([]);
    expect(captionSchedule(5, 0)).toEqual([]);
  });

  it("caps script length to what the assembled Reel can carry", () => {
    expect(MAX_SCRIPT_WORDS).toBeLessThan(120);
    const long = Array.from({ length: MAX_SCRIPT_WORDS + 20 }, () => "word").join(" ");
    expect(scoreUgcAudioHeuristic(long).speechOk).toBe(false);
  });
});

// ── finding 5: Kling only accepts "5" or "10" — "4" 422s and silently demotes ──

describe("motion duration clamp (finding 5)", () => {
  it("snaps Kling onto its only legal values", () => {
    expect(clampDurationForFamily("kling", 4)).toBe(5);
    expect(clampDurationForFamily("kling", 5)).toBe(5);
    expect(clampDurationForFamily("kling", 8)).toBe(10);
    expect(clampDurationForFamily("kling", 10)).toBe(10);
  });

  it("buildMotionInput never hands Kling the old MOTION_SECONDS_PER_SCENE=4", () => {
    const input = buildMotionInput("kling", {
      prompt: "handheld",
      startImageUrl: "https://example.com/a.jpg",
      duration: "4",
    });
    expect(["5", "10"]).toContain(input.duration);
  });

  it("validates whatever seconds the LLM invents", () => {
    expect(normaliseMotionSeconds(undefined)).toBe(5);
    expect(normaliseMotionSeconds("not-a-number")).toBe(5);
    expect(normaliseMotionSeconds(-3)).toBe(5);
    expect(normaliseMotionSeconds(9999)).toBe(30);
    expect(["5", "10"]).toContain(
      buildMotionInput("kling", {
        prompt: "p",
        startImageUrl: "u",
        duration: 9999,
      }).duration,
    );
  });

  it("clamps seedance into its supported range", () => {
    expect(clampDurationForFamily("seedance", 1)).toBe(3);
    expect(clampDurationForFamily("seedance", 30)).toBe(12);
  });

  it("wan carries the duration as frames instead of dropping it", () => {
    const short = buildMotionInput("wan", { prompt: "p", startImageUrl: "u", duration: 4 });
    const long = buildMotionInput("wan", { prompt: "p", startImageUrl: "u", duration: 10 });
    expect(short.num_frames).not.toBe(long.num_frames);
    expect(wanFramesForSeconds(5)).toBe(81);
  });
});

// ── finding 6: fallback models silently discarded aspect, refs and negatives ──

describe("fallback model fidelity (finding 6)", () => {
  it("maps the requested aspect ratio into fal's named sizes", () => {
    expect(namedImageSize("1:1")).toBe("square_hd");
    expect(namedImageSize("9:16")).toBe("portrait_16_9");
    expect(namedImageSize("16:9")).toBe("landscape_16_9");
  });

  it("a 1:1 feed still no longer comes back 9:16 from the fallbacks", () => {
    for (const family of ["flux", "seedream"] as const) {
      const input = buildStillInput(family, { prompt: "p", aspectRatio: "1:1" });
      expect(input.image_size).toBe("square_hd");
    }
  });

  it("seedream keeps the no-text/no-logo negative prompt", () => {
    const input = buildStillInput("seedream", {
      prompt: "p",
      negativePrompt: "no text, no logos, no watermark",
    });
    expect(input.negative_prompt).toBe("no text, no logos, no watermark");
  });

  it("knows which families can carry the client's product photos", () => {
    expect(familyAcceptsImageRefs("nano_banana")).toBe(true);
    expect(familyAcceptsImageRefs("seedream")).toBe(true);
    // Flux Dev on fal is text-to-image: handing it image_urls loses the product.
    expect(familyAcceptsImageRefs("flux")).toBe(false);
  });

  it("motion fallbacks honour the requested aspect ratio", () => {
    for (const family of ["seedance", "wan"] as const) {
      const input = buildMotionInput(family, {
        prompt: "p",
        startImageUrl: "u",
        aspectRatio: "1:1",
      });
      expect(input.aspect_ratio).toBe("1:1");
    }
  });
});

// ── finding 10: "try again" / "shorter" must not buy a fresh paid video ──

describe("UGC retune matcher (finding 10)", () => {
  it("does NOT fire without a UGC noun", () => {
    expect(looksLikeUgcRetune("try again")).toBe(false);
    expect(looksLikeUgcRetune("make it shorter")).toBe(false);
    expect(looksLikeUgcRetune("can you make the caption shorter")).toBe(false);
    expect(looksLikeUgcRetune("more casual please")).toBe(false);
  });

  it("still fires when the client actually means the video", () => {
    expect(looksLikeUgcRetune("try again with the ugc")).toBe(true);
    expect(looksLikeUgcRetune("make the reel shorter")).toBe(true);
    expect(looksLikeUgcRetune("different hook for that video")).toBe(true);
    expect(looksLikeUgcRetune("redo the ad")).toBe(true);
  });

  it("ignores unrelated chatter", () => {
    expect(looksLikeUgcRetune("thanks mate")).toBe(false);
    expect(looksLikeUgcRetune("")).toBe(false);
    expect(looksLikeUgcRetune(null)).toBe(false);
  });
});

// ── finding 2 / 12: cost booked from real submissions, one ledger ──

describe("UGC cost accounting (findings 2, 12)", () => {
  const prev = { ...process.env };
  beforeEach(() => {
    resetServerEnvCache();
    process.env.COST_IMAGE_USD = "0.04";
    process.env.COST_VIDEO_USD = "0.5";
    resetServerEnvCache();
  });
  afterEach(() => {
    process.env = { ...prev };
    resetServerEnvCache();
  });

  it("prices the actual paid submissions, not a flat estimate", () => {
    // One clean job: 3 stills + 3 motions.
    expect(ugcActualCostCents({ still: 3, motion: 3 })).toBe(162);
  });

  it("a burned-through chain costs far more than the 150c estimate", () => {
    // motionForStill: 3 attempts x 3-model chain = 9 paid submissions.
    const worst = ugcActualCostCents({ still: 9, motion: 9 });
    expect(worst).toBeGreaterThan(150);
    expect(worst).toBe(486);
  });

  it("is zero before anything has been submitted", () => {
    expect(ugcActualCostCents({ still: 0, motion: 0 })).toBe(0);
  });
});

// ── finding 12: a missing secondary must not re-bill the same failing model ──

describe("AI video secondary routing (finding 12)", () => {
  const prev = { ...process.env };
  beforeEach(() => {
    _resetAiVideoEnvCache();
    process.env.AI_VIDEO_PRIMARY_MODEL = "vendor/primary";
    delete process.env.AI_VIDEO_SECONDARY_MODEL;
    _resetAiVideoEnvCache();
  });
  afterEach(() => {
    process.env = { ...prev };
    _resetAiVideoEnvCache();
  });

  it("returns null rather than the primary when no distinct secondary exists", () => {
    expect(routeAiVideo("primary")?.model).toBe("vendor/primary");
    expect(routeAiVideo("secondary")).toBeNull();
  });

  it("returns the secondary when one is configured", () => {
    process.env.AI_VIDEO_SECONDARY_MODEL = "vendor/secondary";
    _resetAiVideoEnvCache();
    expect(routeAiVideo("secondary")?.model).toBe("vendor/secondary");
  });

  it("gives a hung job far longer than the kickoff queue's 12 minutes", () => {
    expect(staleAiVideoMinutes()).toBeGreaterThan(12);
  });
});

// ── finding 2: the month-spend query must count 'failed' ──

const { sqlSeen } = vi.hoisted(() => ({ sqlSeen: [] as string[] }));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async (sql: string) => {
      sqlSeen.push(sql);
      return [];
    }),
    queryOne: vi.fn(async (sql: string) => {
      sqlSeen.push(sql);
      if (/sum\(cost_cents\)/.test(sql)) return { n: 0 };
      return null;
    }),
  };
});

describe("monthly cap counts failed jobs (finding 2)", () => {
  beforeEach(() => {
    sqlSeen.length = 0;
  });

  it("queueUgcJob's month-spend query includes 'failed'", async () => {
    const { queueUgcJob } = await import("../ugc/pipeline.js");
    process.env.FAL_KEY = "test-key";
    process.env.ELEVENLABS_API_KEY = "test-key";
    await queueUgcJob(
      { id: "b1", name: "Test", facts: {} } as never,
      "UGC reel for our cold brew, busy mornings",
      ["11111111-1111-1111-1111-111111111111"],
      "organic",
    ).catch(() => undefined);

    const spendSql = sqlSeen.filter((s) => /sum\(cost_cents\)/.test(s));
    expect(spendSql.length).toBeGreaterThan(0);
    // A failed job already paid for everything it generated — excluding it
    // handed the budget straight back.
    for (const sql of spendSql) expect(sql).toMatch(/'failed'/);
  });
});
