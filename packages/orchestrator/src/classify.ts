import { z } from "zod";
import { callLLM } from "./llm.js";
import { looksLikePhotoBackgroundAsk } from "./visualMode.js";

// Six-way inbound classification per BUILD_CONTRACTS.md. Note: "edit" is an
// orchestrator-internal category — the `messages.type` DB column (see
// 0001_init.sql) only allows media|instruction|approval|question|other, so
// callers must map "edit" -> "instruction" before persisting (see
// processInbound.ts's toDbMessageType).
export const InboundClassification = [
  "approval",
  "edit",
  "media",
  "question",
  "instruction",
  "other",
] as const;
export type InboundClassification = (typeof InboundClassification)[number];

export interface ClassifyResult {
  classification: InboundClassification;
  confidence: number; // 0..1
  reasoning?: string;
}

const APPROVAL_RE =
  /^(yes|yep|yup|yeah|y|ok|okay|k|sounds good|sg|good|great|approve(d)?|go for it|do it|perfect|love it|nice|looks good|lgtm)[.!\s]*(👍|✅|👌|🙌|🔥)?$/i;
const APPROVAL_EMOJI_ONLY_RE = /^[\s👍✅👌🙌🔥]+$/u;

/** Casual positive vibes with nothing actionable — not an approval ask. */
const AFFIRMATION_RE =
  /^\s*(?:awesome|amazing|amazing thanks|fantastic|wonderful|brilliant|excellent|lovely|sweet|sick|dope|fire|rad|cool|legend|beaut(?:y)?|ace|solid|good stuff|nice one|love that|love this|this is (?:great|awesome|perfect)|so good)[.!\s]*$/i;

export function looksLikeAffirmation(body: string): boolean {
  const t = (body ?? "").trim();
  if (!t) return false;
  if (AFFIRMATION_RE.test(t)) return true;
  // Short vibes that aren't explicit yes/approve (those stay approval when pending).
  return /^(awesome|amazing|fantastic|wonderful|brilliant|sweet|sick|cool|fire|rad|legend|beauty|ace)[.!\s]*$/i.test(t);
}

const QUESTION_WORDS = [
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
  "can",
  "could",
  "should",
  "is",
  "are",
  "do",
  "does",
  "did",
  "will",
  "would",
];

const EDIT_SIGNALS = [
  "change",
  "make it",
  "shorter",
  "longer",
  "instead",
  "reword",
  "edit",
  "fix",
  "replace",
  "remove",
  "different caption",
  "try again",
  "redo",
  "less emoji",
  "no emoji",
  "swap",
  "reduce",
  "rewrite",
  "tweak",
  "not quite",
];

/**
 * Cheap deterministic pass — covers the overwhelming majority of real SMS
 * traffic without spending a token. Returns null when genuinely ambiguous,
 * in which case classifyInbound() falls back to an LLM call.
 */
export function ruleBasedClassify(
  body: string | null,
  hasMedia: boolean,
  hasPendingPost: boolean,
): ClassifyResult | null {
  const text = (body ?? "").trim();

  if (hasMedia) {
    // New media is always treated as new content, regardless of any
    // accompanying text (which draftCaption uses as extra guidance).
    return { classification: "media", confidence: 1 };
  }

  if (text.length === 0) {
    return { classification: "other", confidence: 0.3 };
  }

  if (APPROVAL_RE.test(text) || APPROVAL_EMOJI_ONLY_RE.test(text)) {
    // Without something to approve, "yes"/"great"/"perfect" are just vibes —
    // not an approval action. Leave as other so chatBack handles them warmly.
    if (!hasPendingPost) {
      return { classification: "other", confidence: 0.85 };
    }
    return { classification: "approval", confidence: 0.95 };
  }

  const lower = text.toLowerCase();

  // Edit words dominate the classification: "can you make it shorter" reads as a
  // question ("can you...") but is really an edit. With a pending draft to act on
  // it's an edit; without one there's nothing to edit, so it's genuinely ambiguous
  // — defer to the LLM (null) rather than mislabel it a question.
  const looksLikeEdit = EDIT_SIGNALS.some((s) => lower.includes(s));
  if (looksLikeEdit) {
    return hasPendingPost ? { classification: "edit", confidence: 0.8 } : null;
  }

  // "Could you put pictures in the background of them?" starts with Could → question,
  // but with pending drafts it is a visual redo — route as edit so we regenerate
  // with real photos instead of chatting + re-shipping text cards.
  if (hasPendingPost && looksLikePhotoBackgroundAsk(text)) {
    return { classification: "edit", confidence: 0.9 };
  }

  const looksLikeQuestion =
    text.endsWith("?") || QUESTION_WORDS.some((w) => lower.startsWith(w + " "));
  if (looksLikeQuestion) {
    return { classification: "question", confidence: 0.85 };
  }

  return null;
}

const classificationSchema = z.object({
  classification: z.enum(InboundClassification),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

const CLASSIFY_SYSTEM_PROMPT = `You classify an inbound SMS from a social-media client into exactly one category:
- "approval": a plain yes/ok/thumbs-up style approval of a pending draft. ONLY use this when a pending draft exists. If nothing is pending, prefer "other" for casual vibes like "awesome"/"great"/"cool".
- "edit": a correction or change request aimed at a pending draft post.
- "media": (never used here — media is detected before this LLM call runs).
- "question": the client is asking something.
- "instruction": a standing directive not tied to editing a specific pending draft (e.g. posting cadence, general preferences).
- "other": doesn't clearly fit any of the above, or you are unsure.

Respond with ONLY a JSON object, no markdown fences, no prose:
{"classification": "<one of the categories>", "confidence": <0..1 number>, "reasoning": "<one short sentence>"}

Be honest about confidence — use a low number (< 0.5) when genuinely unsure rather than guessing.`;

/**
 * Full classification: rule-based first, LLM fallback for anything
 * ambiguous. The LLM branch is the only part that needs mocking in tests.
 */
export async function classifyInbound(params: {
  body: string | null;
  hasMedia: boolean;
  hasPendingPost: boolean;
}): Promise<ClassifyResult> {
  const rule = ruleBasedClassify(params.body, params.hasMedia, params.hasPendingPost);
  if (rule) return rule;

  try {
    const raw = await callLLM({
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Message: """${params.body ?? ""}"""\nHas a pending draft post: ${params.hasPendingPost}`,
        },
      ],
      maxTokens: 200,
    });
    const parsed = classificationSchema.parse(JSON.parse(extractJson(raw)));
    return parsed;
  } catch {
    // Malformed LLM output or LLM failure — never guess-and-act.
    return { classification: "other", confidence: 0 };
  }
}
