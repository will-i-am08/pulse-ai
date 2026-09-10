// Deterministic caption analysis — the "little tiny details" that make writing
// sound like a specific person, computed in code (not guessed by a model) so
// they're exact and reproducible. The model gets these numbers as ground truth
// when it writes the voice guide, rather than eyeballing frequencies itself.

export interface TextStats {
  postCount: number;
  withCaption: number;
  avgWordsPerCaption: number;
  medianWordsPerCaption: number;
  emojiPerPost: number;
  postsWithEmojiPct: number;
  topEmojis: { emoji: string; count: number }[];
  exclamationPerPost: number;
  postsWithExclamationPct: number;
  postsWithEllipsisPct: number;
  postsWithQuestionPct: number;
  avgHashtagsPerPost: number;
  hashtagPlacement: "none" | "inline" | "trailing" | "mixed";
  topHashtags: { tag: string; count: number }[];
  allLowercasePct: number; // captions that never use a capital letter
  allCapsWordPct: number; // share of posts that shout at least one ALL-CAPS word
  lineBreakHeavyPct: number; // posts with 3+ line breaks (spaced-out style)
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function topN<T extends string>(counts: Map<T, number>, n: number): { key: T; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

export function computeTextStats(captions: (string | null | undefined)[]): TextStats {
  const posts = captions.map((c) => (typeof c === "string" ? c : "")).map((c) => c ?? "");
  const postCount = posts.length;
  const nonEmpty = posts.filter((c) => c.trim().length > 0);

  const wordCounts = nonEmpty.map((c) => words(c).length);
  const emojiCounts = new Map<string, number>();
  const hashtagCounts = new Map<string, number>();

  let totalEmoji = 0;
  let postsWithEmoji = 0;
  let totalExcl = 0;
  let postsWithExcl = 0;
  let postsWithEllipsis = 0;
  let postsWithQuestion = 0;
  let totalHashtags = 0;
  let inlineHashtagPosts = 0;
  let trailingHashtagPosts = 0;
  let allLowercase = 0;
  let allCapsWordPosts = 0;
  let lineBreakHeavy = 0;

  for (const c of posts) {
    const emojis = c.match(EMOJI_RE) ?? [];
    if (emojis.length) postsWithEmoji++;
    totalEmoji += emojis.length;
    for (const e of emojis) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);

    const excl = (c.match(/!/g) ?? []).length;
    totalExcl += excl;
    if (excl) postsWithExcl++;

    if (/(\.{3,}|…)/.test(c)) postsWithEllipsis++;
    if (/\?/.test(c)) postsWithQuestion++;

    const tags = c.match(HASHTAG_RE) ?? [];
    totalHashtags += tags.length;
    for (const t of tags) hashtagCounts.set(t.toLowerCase(), (hashtagCounts.get(t.toLowerCase()) ?? 0) + 1);
    if (tags.length) {
      // Trailing if the hashtags are clustered at the end (after the last
      // non-hashtag word); inline if woven through the body.
      const withoutTags = c.replace(HASHTAG_RE, "").trim();
      const tail = c.slice(withoutTags.length ? c.lastIndexOf(withoutTags.split(/\s+/).pop() ?? "") : 0);
      const tailIsMostlyTags = (tail.match(HASHTAG_RE) ?? []).length >= Math.ceil(tags.length * 0.7);
      if (tailIsMostlyTags) trailingHashtagPosts++;
      else inlineHashtagPosts++;
    }

    const letters = c.replace(/[^\p{L}]/gu, "");
    if (letters.length > 0 && letters === letters.toLowerCase()) allLowercase++;
    if (/\b[\p{Lu}]{3,}\b/u.test(c)) allCapsWordPosts++;
    if ((c.match(/\n/g) ?? []).length >= 3) lineBreakHeavy++;
  }

  const hashtagPostCount = inlineHashtagPosts + trailingHashtagPosts;
  let hashtagPlacement: TextStats["hashtagPlacement"] = "none";
  if (hashtagPostCount > 0) {
    if (trailingHashtagPosts > hashtagPostCount * 0.7) hashtagPlacement = "trailing";
    else if (inlineHashtagPosts > hashtagPostCount * 0.7) hashtagPlacement = "inline";
    else hashtagPlacement = "mixed";
  }

  const pct = (n: number) => (postCount ? round((n / postCount) * 100, 1) : 0);

  return {
    postCount,
    withCaption: nonEmpty.length,
    avgWordsPerCaption: wordCounts.length ? round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length, 1) : 0,
    medianWordsPerCaption: round(median(wordCounts), 1),
    emojiPerPost: postCount ? round(totalEmoji / postCount, 2) : 0,
    postsWithEmojiPct: pct(postsWithEmoji),
    topEmojis: topN(emojiCounts, 8).map(({ key, count }) => ({ emoji: key, count })),
    exclamationPerPost: postCount ? round(totalExcl / postCount, 2) : 0,
    postsWithExclamationPct: pct(postsWithExcl),
    postsWithEllipsisPct: pct(postsWithEllipsis),
    postsWithQuestionPct: pct(postsWithQuestion),
    avgHashtagsPerPost: postCount ? round(totalHashtags / postCount, 2) : 0,
    hashtagPlacement,
    topHashtags: topN(hashtagCounts, 10).map(({ key, count }) => ({ tag: key, count })),
    allLowercasePct: pct(allLowercase),
    allCapsWordPct: pct(allCapsWordPosts),
    lineBreakHeavyPct: pct(lineBreakHeavy),
  };
}
