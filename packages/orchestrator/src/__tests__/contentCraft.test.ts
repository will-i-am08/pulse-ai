import { describe, it, expect } from "vitest";
import {
  CONTENT_JOBS,
  inferContentJob,
  formatBiasForJob,
  pickUnderrepresentedJob,
  isContentJob,
} from "../contentJobs.js";
import {
  pickHookFormulas,
  scoreHookLine,
  isBannedHookOpener,
  listHookFormulas,
} from "../hooks.js";
import {
  humanizeCaption,
  limitHashtags,
  feedFoldPreview,
  captionJobForFormat,
  FEED_FOLD_CHARS,
  MAX_HASHTAGS,
  stripInvisibleChars,
  replaceSlopPhrases,
} from "../humanizeCaption.js";

describe("contentJobs", () => {
  it("exposes the five Jake-style jobs", () => {
    expect([...CONTENT_JOBS]).toEqual(["proof", "teach", "opinion", "story", "offer"]);
  });

  it("infers jobs from pillar language", () => {
    expect(inferContentJob({ key: "social_proof", name: "Wins" })).toBe("proof");
    expect(inferContentJob({ name: "How-to tips", description: "teach the craft" })).toBe("teach");
    expect(inferContentJob({ name: "Hot takes", description: "opinionated rants" })).toBe("opinion");
    expect(inferContentJob({ name: "Founder diary", description: "behind the scenes story" })).toBe("story");
    expect(inferContentJob({ name: "Book now", description: "offer and CTA" })).toBe("offer");
    expect(inferContentJob({ content_job: "proof" })).toBe("proof");
    expect(isContentJob("teach")).toBe(true);
    expect(isContentJob("nope")).toBe(false);
  });

  it("biases formats by job (Reels for discovery, carousel for offer)", () => {
    expect(formatBiasForJob("proof", { needDiscovery: true })).toBe("reel");
    expect(formatBiasForJob("opinion", { needDiscovery: true })).toBe("reel");
    expect(formatBiasForJob("offer")).toBe("carousel");
    expect(formatBiasForJob("teach", { needDiscovery: false })).toBe("carousel");
  });

  it("picks underrepresented jobs favoring opinion/story gaps", () => {
    const recent = ["teach", "teach", "proof", "offer"] as const;
    const next = pickUnderrepresentedJob([...recent]);
    expect(["opinion", "story"]).toContain(next);
  });
});

describe("hooks", () => {
  it("loads curated formulas", () => {
    expect(listHookFormulas().length).toBeGreaterThanOrEqual(8);
  });

  it("picks formulas for a job", () => {
    const picks = pickHookFormulas("proof", 3);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it("scores specific hooks higher than banned openers", () => {
    expect(isBannedHookOpener("Hey guys welcome back")).toBe(true);
    expect(scoreHookLine("Hey guys welcome back")).toBe(0);
    expect(scoreHookLine("$12k is what one missed follow-up cost us.")).toBeGreaterThan(5);
  });
});

describe("humanizeCaption / Job A-B helpers", () => {
  it("maps reel to Job A and feed to Job B", () => {
    expect(captionJobForFormat("reel")).toBe("A");
    expect(captionJobForFormat("feed")).toBe("B");
    expect(captionJobForFormat("carousel")).toBe("B");
  });

  it("strips invisible chars and slop phrases", () => {
    const raw = "Let​us delve into this game-changer﻿";
    const out = humanizeCaption(raw);
    expect(out).not.toMatch(/\u200b|\ufeff/i);
    expect(out.toLowerCase()).not.toContain("delve into");
    expect(out.toLowerCase()).not.toContain("game-changer");
  });

  it("caps hashtags at 5", () => {
    const caption = "Hello world #a #b #c #d #e #f #g";
    const limited = limitHashtags(caption, MAX_HASHTAGS);
    const tags = limited.match(/#\w+/g) ?? [];
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it("reports ~125-char feed fold", () => {
    const long = "x".repeat(200);
    const fold = feedFoldPreview(long);
    expect(fold.truncated).toBe(true);
    expect(fold.visible.length).toBeLessThanOrEqual(FEED_FOLD_CHARS);
  });

  it("stripInvisibleChars removes zero-width space", () => {
    expect(stripInvisibleChars("a​b")).toBe("ab");
  });

  it("replaceSlopPhrases swaps leverage", () => {
    expect(replaceSlopPhrases("We leverage AI daily").toLowerCase()).toContain("use");
  });
});
