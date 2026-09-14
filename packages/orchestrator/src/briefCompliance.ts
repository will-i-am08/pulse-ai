import { callLLM } from "./llm.js";

/**
 * Post-draft brief compliance — did we actually deliver what the owner asked?
 * Runs on caption / overlays / photo prompts BEFORE we SMS (and ideally before
 * expensive image gen) so Kip can reinforce and redo instead of shipping a miss.
 */

export type BriefComplianceInput = {
  brief: string;
  caption: string;
  /** Overlay / card lines burned on the visual. */
  overlays?: string[];
  /** Image prompts used (or about to be used). */
  photoPrompts?: string[];
  surface: "feed" | "carousel";
};

export type BriefComplianceResult = {
  pass: boolean;
  reasons: string[];
  /** Append onto topicHint when regenerating. */
  reinforceHint: string;
};

const COMPARE_RE =
  /\b(compar(e|ing|ison)|vs\.?|versus|side[- ]by[- ]side|difference between|which (is|one'|ones?|tool)|pros? and cons?)\b/i;

const CITYSCAPE_RE =
  /\b(city\s*scapes?|skylines?|city\s+(?:background|bg|backdrop)|urban (?:night|dusk|skyline)|as the background)\b/i;

const TOOL_NAME_RE =
  /\b(claude|chatgpt|gpt-?4o?|cursor|copilot|gemini|grok|windsurf|replit|tabnine|codeium|devin|aider|codex|sonnet|opus)\b/gi;

export function looksLikeComparisonBrief(brief: string | null | undefined): boolean {
  return COMPARE_RE.test(brief ?? "");
}

export function looksLikeCityscapeBrief(brief: string | null | undefined): boolean {
  return CITYSCAPE_RE.test(brief ?? "");
}

export function looksLikeSingularPostBrief(brief: string | null | undefined): boolean {
  const t = (brief ?? "").trim();
  if (!t) return false;
  if (/\bcarr?ousels?\b/i.test(t)) return false;
  return (
    /\b(a|an|one|single)\s+posts?\b/i.test(t) ||
    /\bdo\s*up\s+a\s+post\b/i.test(t) ||
    /\b(post)\s+(comparing|about|with|on|for)\b/i.test(t)
  );
}

function blobOf(input: BriefComplianceInput): string {
  return [input.caption, ...(input.overlays ?? []), ...(input.photoPrompts ?? [])]
    .filter(Boolean)
    .join("\n");
}

/** Fast checks before spending an LLM call. */
export function heuristicBriefCompliance(input: BriefComplianceInput): BriefComplianceResult {
  const brief = input.brief.trim();
  if (!brief) {
    return { pass: true, reasons: [], reinforceHint: "" };
  }
  const blob = blobOf(input);
  const reasons: string[] = [];
  const reinforces: string[] = [];

  if (looksLikeComparisonBrief(brief)) {
    const tools = blob.match(TOOL_NAME_RE) ?? [];
    const unique = new Set(tools.map((t) => t.toLowerCase()));
    const hasVs = /\bvs\.?\b|\bversus\b|\bcompared to\b|\bunlike\b/i.test(blob);
    if (unique.size < 2 && !hasVs) {
      reasons.push("brief asks for a comparison but copy never contrasts specific options");
      reinforces.push(
        "MUST actually COMPARE at least two named AI coding tools (e.g. Cursor vs Claude Code vs Copilot) with a concrete difference — not a vague tip about 'AI tools'",
      );
    }
  }

  if (looksLikeCityscapeBrief(brief)) {
    const visualBlob = [...(input.photoPrompts ?? []), blob].join("\n");
    if (!CITYSCAPE_RE.test(visualBlob) && !/\b(city|skyline|urban|downtown|metropolis)\b/i.test(visualBlob)) {
      reasons.push("brief asks for cityscape/skyline background but prompts/copy omit it");
      reinforces.push(
        "Background MUST be a cinematic cityscape / skyline (night or dusk urban lights) — not an office, desk, or abstract gradient",
      );
    }
  }

  if (looksLikeSingularPostBrief(brief) && input.surface === "carousel") {
    reasons.push("brief asked for a single post but draft is a carousel");
    reinforces.push("Deliver ONE feed post (not a multi-slide carousel)");
  }

  // Subject drift: if brief names a clear noun phrase and caption is about hiring/email unrelated.
  if (
    /\b(ai coding tools?|coding tools?)\b/i.test(brief) &&
    /\b(hir(e|ing)|recruit|interview|cold email|inbox)\b/i.test(blob) &&
    !/\b(ai|coding|claude|cursor|copilot|chatgpt)\b/i.test(blob)
  ) {
    reasons.push("brief is about AI coding tools but copy drifted to an unrelated topic");
    reinforces.push("Stay on AI coding tools — do not pivot to hiring, email, or generic founder advice");
  }

  const pass = reasons.length === 0;
  return {
    pass,
    reasons,
    reinforceHint: reinforces.join(". "),
  };
}

/**
 * LLM review of draft vs owner brief. Prefer calling after heuristic fails, or
 * always for comparison briefs. Returns pass + reinforceHint for a redo.
 */
export async function reviewBriefCompliance(
  input: BriefComplianceInput,
): Promise<BriefComplianceResult> {
  const brief = input.brief.trim();
  if (!brief) return { pass: true, reasons: [], reinforceHint: "" };

  const heuristic = heuristicBriefCompliance(input);
  // Hard heuristic fails are enough to reject without an LLM round-trip.
  if (!heuristic.pass && heuristic.reasons.some((r) => /comparison|cityscape|carousel|drifted/i.test(r))) {
    return heuristic;
  }

  try {
    const raw = await callLLM({
      system: [
        "You are a ruthless brief-compliance checker for social drafts.",
        "Decide if the draft DELIVERS the owner's ask — not whether it's nicely written.",
        "Comparing X means naming/contrasting specific options with a real difference, not vaguely mentioning the category.",
        "Background/visual asks in the brief must show up in photo prompts.",
        'Output ONLY JSON: {"pass":true|false,"reasons":["..."],"reinforce_hint":"<one imperative sentence to fix the next attempt, empty if pass>"}',
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Owner brief: ${brief}`,
            `Surface: ${input.surface}`,
            `Caption: ${input.caption}`,
            `Overlays: ${(input.overlays ?? []).join(" | ") || "(none)"}`,
            `Photo prompts: ${(input.photoPrompts ?? []).join(" | ") || "(none)"}`,
          ].join("\n"),
        },
      ],
      maxTokens: 280,
      temperature: 0,
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return heuristic;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      pass?: boolean;
      reasons?: unknown;
      reinforce_hint?: unknown;
      reinforceHint?: unknown;
    };
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.map((r) => String(r)).filter(Boolean)
      : heuristic.reasons;
    const reinforceHint = String(parsed.reinforce_hint ?? parsed.reinforceHint ?? heuristic.reinforceHint ?? "").trim();
    const pass = Boolean(parsed.pass) && reasons.length === 0;
    if (pass) return { pass: true, reasons: [], reinforceHint: "" };
    return {
      pass: false,
      reasons: reasons.length ? reasons : heuristic.reasons.length ? heuristic.reasons : ["draft does not satisfy the owner brief"],
      reinforceHint:
        reinforceHint ||
        heuristic.reinforceHint ||
        "Redo the draft so it fully satisfies every part of the owner brief",
    };
  } catch (err) {
    console.error("reviewBriefCompliance: LLM failed, using heuristic", err);
    return heuristic;
  }
}

/** Merge reinforce hint into a topicHint for a regeneration pass. */
export function reinforceTopicHint(topicHint: string, reinforceHint: string): string {
  const base = topicHint.trim();
  const bit = reinforceHint.trim();
  if (!bit) return base.slice(0, 400);
  if (!base) return bit.slice(0, 400);
  if (base.toLowerCase().includes(bit.toLowerCase().slice(0, 40))) return base.slice(0, 400);
  return `${base} — COMPLIANCE FIX: ${bit}`.slice(0, 400);
}
