/**
 * Local chat humanize — reuses caption slop swaps + chat sanitize.
 * No hashtag logic (that's caption-only).
 */

import { sanitizeChatText } from "@pulse/shared";
import { replaceSlopPhrases, stripInvisibleChars } from "../humanizeCaption.js";

/** Extra chat-only AI tells not always in the caption lexicon. */
const CHAT_SLOP: Array<{ find: RegExp; replace: string }> = [
  { find: /\bI hope this (message |note )?finds you well\b/gi, replace: "" },
  { find: /\bDon't hesitate to (reach out|ask)\b/gi, replace: "Just shout if you need me" },
  { find: /\bPlease (let me know|feel free)\b/gi, replace: "Let me know" },
  { find: /\bAs an AI( language model| social media manager)?[, ]*/gi, replace: "" },
  { find: /\bI'd be happy to (help|assist)\b/gi, replace: "I can" },
  { find: /\bLet me know if you (have any questions|need anything else)\b/gi, replace: "Shout if you need me" },
  { find: /\bThank you for (your|the) (patience|understanding)\b/gi, replace: "Thanks" },
  { find: /\bJust wanted to (reach out|check in)\b/gi, replace: "Quick one" },
  { find: /\bI wanted to (reach out|touch base)\b/gi, replace: "Quick one" },
  { find: /\bTouching base\b/gi, replace: "Checking in" },
];

export function humanizeChat(input: string): string {
  let out = stripInvisibleChars(input ?? "");
  out = replaceSlopPhrases(out);
  for (const { find, replace } of CHAT_SLOP) {
    out = out.replace(find, replace);
  }
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return sanitizeChatText(out);
}
