import { describe, it, expect } from "vitest";
import { computeTextStats } from "../voice/textStats.js";

describe("computeTextStats", () => {
  const captions = [
    "just landed in tokyo 🔥🔥 can't wait!!!",
    "New collection dropping soon... stay tuned #fashion #style",
    "", // a photo-only post with no caption
  ];
  const stats = computeTextStats(captions);

  it("counts posts and captions separately", () => {
    expect(stats.postCount).toBe(3);
    expect(stats.withCaption).toBe(2);
  });

  it("measures emoji frequency and surfaces the favourites", () => {
    expect(stats.emojiPerPost).toBeCloseTo(0.67, 1);
    expect(stats.postsWithEmojiPct).toBeCloseTo(33.3, 1);
    expect(stats.topEmojis[0]).toEqual({ emoji: "🔥", count: 2 });
  });

  it("tracks exclamation, ellipsis and question habits", () => {
    expect(stats.exclamationPerPost).toBeCloseTo(1, 5); // three "!" over three posts
    expect(stats.postsWithExclamationPct).toBeCloseTo(33.3, 1);
    expect(stats.postsWithEllipsisPct).toBeCloseTo(33.3, 1);
    expect(stats.postsWithQuestionPct).toBe(0);
  });

  it("reads hashtag volume and placement", () => {
    expect(stats.avgHashtagsPerPost).toBeCloseTo(0.67, 1);
    expect(stats.hashtagPlacement).toBe("trailing");
    expect(stats.topHashtags.map((h) => h.tag)).toEqual(expect.arrayContaining(["#fashion", "#style"]));
  });

  it("detects an all-lowercase writer", () => {
    expect(stats.allLowercasePct).toBeCloseTo(33.3, 1); // only the tokyo post
    expect(stats.allCapsWordPct).toBe(0);
  });

  it("computes average and median caption length in words", () => {
    expect(stats.avgWordsPerCaption).toBeCloseTo(7.5, 1);
    expect(stats.medianWordsPerCaption).toBeCloseTo(7.5, 1);
  });

  it("is safe on an empty corpus", () => {
    const empty = computeTextStats([]);
    expect(empty.postCount).toBe(0);
    expect(empty.emojiPerPost).toBe(0);
    expect(empty.hashtagPlacement).toBe("none");
    expect(empty.topEmojis).toEqual([]);
  });
});
