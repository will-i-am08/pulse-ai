/**
 * Local anti-slop pass before owner sees a draft (no extra LLM hop).
 * Strips invisible chars, swaps common AI tells, enforces hashtag ≤5,
 * and exposes Job A/B + ~125-char fold helpers.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeChatText } from "@pulse/shared";
import type { PostFormat } from "@pulse/shared";

export const FEED_FOLD_CHARS = 125;
export const MAX_HASHTAGS = 5;

type SlopPhrase = { find: string; replace: string };
type SlopLexicon = { invisible_codepoints?: string[]; phrases?: SlopPhrase[] };

let lexicon: SlopLexicon | null = null;

function loadLexicon(): SlopLexicon {
  if (lexicon) return lexicon;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    lexicon = JSON.parse(readFileSync(join(here, "data", "slop.json"), "utf8")) as SlopLexicon;
  } catch {
    lexicon = { phrases: [] };
  }
  return lexicon;
}

/** Caption job: A = media already hooked (Reel); B = caption must hook (feed/carousel). */
export type CaptionJob = "A" | "B";

export function captionJobForFormat(format: PostFormat | "reel" | "feed" | "carousel" | "story" | null | undefined): CaptionJob {
  if (format === "reel") return "A";
  return "B";
}

export function stripInvisibleChars(input: string): string {
  const lex = loadLexicon();
  let out = input ?? "";
  for (const cp of lex.invisible_codepoints ?? []) {
    if (!cp) continue;
    out = out.split(cp).join("");
  }
  // Extra common invisibles
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, "");
  return out;
}

export function replaceSlopPhrases(input: string): string {
  let out = input ?? "";
  for (const p of loadLexicon().phrases ?? []) {
    if (!p.find) continue;
    const re = new RegExp(p.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, p.replace ?? "");
  }
  // Collapse leftover double spaces from empty replacements.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** Keep at most MAX_HASHTAGS hashtags; prefer ones at the end. */
export function limitHashtags(input: string, max = MAX_HASHTAGS): string {
  const tags = input.match(/#[\w]+/g) ?? [];
  if (tags.length <= max) return input;
  const keep = new Set(tags.slice(-max));
  let seen = 0;
  const allowed = new Set<string>();
  for (const t of tags) {
    if (keep.has(t) && !allowed.has(t.toLowerCase()) && allowed.size < max) {
      allowed.add(t.toLowerCase());
    }
  }
  // Remove excess hashtags from body (case-insensitive).
  return input
    .replace(/#[\w]+/g, (tag) => {
      const key = tag.toLowerCase();
      if (allowed.has(key)) {
        allowed.delete(key); // keep first kept occurrence
        seen++;
        return tag;
      }
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ \n/g, "\n")
    .trim();
}

/** Visible feed window (~125 chars) — for lint / Job B prompts. */
export function feedFoldPreview(caption: string, limit = FEED_FOLD_CHARS): {
  visible: string;
  truncated: boolean;
} {
  const t = (caption ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= limit) return { visible: t, truncated: false };
  return { visible: t.slice(0, Math.max(0, limit - 1)).trimEnd() + "…", truncated: true };
}

export function captionJobPrompt(job: CaptionJob): string {
  if (job === "A") {
    return [
      "Caption Job A (Reel already hooked on-screen/spoken): do NOT re-hook in line 1.",
      "Use the caption for context, a question, and 1–3 search phrases in the body.",
      `First ${FEED_FOLD_CHARS} chars still matter for shares-to-feed — keep them clean.`,
      `At most ${MAX_HASHTAGS} hashtags; prefer search terms in the body over hashtag spam.`,
    ].join("\n");
  }
  return [
    "Caption Job B (photo/carousel — caption IS the hook): put the hook in the first line.",
    `The first ${FEED_FOLD_CHARS} characters are the feed window before "more" — front-load the stake.`,
    `At most ${MAX_HASHTAGS} hashtags; put searchable phrases in the body.`,
  ].join("\n");
}

/**
 * Full local humanize pipeline: invisibles → slop lexicon → hashtag cap → sanitizeChatText.
 */
export function humanizeCaption(input: string): string {
  let out = stripInvisibleChars(input);
  out = replaceSlopPhrases(out);
  out = limitHashtags(out, MAX_HASHTAGS);
  out = sanitizeChatText(out);
  return out;
}
