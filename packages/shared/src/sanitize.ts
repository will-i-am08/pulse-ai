// Chat-text sanitiser — the forever ban on em dashes (and friends) in
// anything Pulse writes to a human. Prompts ask the model not to use them,
// but prompts are wishes; this is the guarantee. Every owner-thread message,
// platform reply, and caption passes through here before it goes out.

/**
 * Make model output safe for chat + captions:
 *  - em/en dashes become commas (or vanish at string edges)
 *  - markdown bold/italic markers stripped (they render literally on SMS)
 *  - whitespace collapsed
 */
export function sanitizeChatText(input: string): string {
  let out = input ?? "";
  // Dashes first: "word — word" reads naturally as "word, word".
  out = out.replace(/\s*[—–]+\s*/g, (m, offset: number, full: string) => {
    const before = full.slice(0, offset).trimEnd();
    const after = full.slice(offset + m.length).trimStart();
    if (!before || !after) return "";
    // Sentence-ending dash reads better as a full stop.
    if (/[.!?]$/.test(before)) return " ";
    return ", ";
  });
  // Strip markdown the model slips in (**bold**, *italics*, __underline__).
  out = out.replace(/(\*\*|__)(.*?)\1/g, "$2");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2");
  // Spaced hyphens doing dash work ("stuff - are you X") read the same as an
  // em dash. Fold them into commas, but never touch line-start bullets or
  // hyphenated words (no spaces around those).
  out = out.replace(/(\S) - (\S)/g, "$1, $2");
  // Tidy up: 3+ newlines to 2, trailing spaces, stray space before punctuation.
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/[ \t]+$/gm, "");
  out = out.replace(/ ,/g, ",").replace(/ \./g, ".");
  out = out.replace(/,{2,}/g, ",");
  return out.trim();
}

/** True when text is clean to send — used by tests and the lint check. */
export function isChatClean(input: string): boolean {
  return !/[—–]/.test(input) && !/(\*\*|__)/.test(input);
}
