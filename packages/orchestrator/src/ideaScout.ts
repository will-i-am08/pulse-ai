/**
 * Content-idea scout — reuses deep research + competitor watches/snapshots
 * instead of a parallel free-form web search. Mush: list what we already know,
 * refresh via runDeepResearch when thin, then synthesise post ideas from that bank.
 */

import type { Brand, ResearchFindings, ResearchSnapshot } from "@pulse/shared";
import { brandContextForPrompt } from "./brandContext.js";
import { listCompetitorWatches } from "./competitors.js";
import { callLLM, stripMarkdown } from "./llm.js";
import { brandTalkingIdentity, personaVoiceLines } from "./persona.js";
import {
  detectResearchFocus,
  listRecentSnapshots,
  runDeepResearch,
  type ResearchFocus,
} from "./research.js";

export type ScoutIdea = {
  title: string;
  angle: string;
  format: string;
  why: string;
  inspired_by?: string;
};

export type IdeaResearchBank = {
  text: string;
  thin: boolean;
  snapshotCount: number;
  watchNames: string[];
};

export type ScoutContentIdeasResult =
  | { ok: true; ideas: ScoutIdea[]; note?: string; researchRefreshed: boolean; bankChars: number }
  | { ok: false; error: string };

function asList(v: unknown, cap = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, cap);
}

function findingsLines(findings: ResearchFindings | null | undefined, subject: string): string[] {
  if (!findings || typeof findings !== "object") return [];
  const lines: string[] = [];
  const hooks = asList(findings.competitor_hooks);
  const ctas = asList(findings.competitor_ctas);
  const ads = asList(findings.ad_library_angles);
  const themes = asList(findings.organic_themes);
  const pain = asList(findings.pain_language);
  const swipe = asList(findings.swipe_formulas);
  const outliers = asList(findings.outlier_angles);
  if (hooks.length) lines.push(`${subject} hooks: ${hooks.join("; ")}`);
  if (ctas.length) lines.push(`${subject} CTAs: ${ctas.join("; ")}`);
  if (ads.length) lines.push(`${subject} Ad Library angles: ${ads.join("; ")}`);
  if (themes.length) lines.push(`${subject} organic themes: ${themes.join("; ")}`);
  if (pain.length) lines.push(`Pain language: ${pain.join("; ")}`);
  if (swipe.length) lines.push(`Swipe formulas: ${swipe.join("; ")}`);
  if (outliers.length) lines.push(`Outlier angles: ${outliers.join("; ")}`);
  return lines;
}

function snapshotHasIdeaSignal(s: ResearchSnapshot): boolean {
  const f = s.findings ?? {};
  return Boolean(
    asList(f.competitor_hooks, 1).length ||
      asList(f.ad_library_angles, 1).length ||
      asList(f.organic_themes, 1).length ||
      asList(f.pain_language, 1).length ||
      asList(f.outlier_angles, 1).length ||
      (s.summary && s.summary.trim().length > 40),
  );
}

/** Compact bank from recent research_snapshots + watched competitor names. */
export async function gatherIdeaResearchBank(brandId: string): Promise<IdeaResearchBank> {
  const [snapshots, watches] = await Promise.all([
    listRecentSnapshots(brandId, { days: 21, limit: 8 }),
    listCompetitorWatches(brandId).catch(() => []),
  ]);
  const watchNames = watches.map((w) => w.name).filter(Boolean);
  const lines: string[] = [];

  if (watchNames.length) {
    lines.push(`Watched competitors: ${watchNames.join(", ")}`);
    for (const w of watches.slice(0, 3)) {
      if (w.last_snapshot?.trim()) {
        lines.push(`${w.name} last watch snapshot: ${w.last_snapshot.trim().slice(0, 400)}`);
      }
    }
  }

  for (const s of snapshots) {
    const when = new Date(s.created_at).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const subject = (s.subject || s.kind || "research").trim();
    lines.push(`[${when}] ${s.kind}/${subject}: ${s.summary.slice(0, 280)}`);
    lines.push(...findingsLines(s.findings, subject));
  }

  const text = lines.join("\n").trim();
  const thin =
    snapshots.filter(snapshotHasIdeaSignal).length === 0 &&
    !watches.some((w) => (w.last_snapshot ?? "").trim().length > 40);

  return {
    text: text || "(no prior competitor / niche research on file)",
    thin,
    snapshotCount: snapshots.length,
    watchNames,
  };
}

function resolveScoutFocus(focus: string, watchNames: string[]): ResearchFocus {
  const detected = detectResearchFocus(focus);
  if (detected) return detected;
  if (/\b(competitor|rival|ad library|ads? they|what .+ (?:doing|posting|running))\b/i.test(focus)) {
    return "competitors";
  }
  if (watchNames.length > 0) return "competitors";
  return "all";
}

/** Brand signals the scout can lean on when competitor research is thin. */
export function brandGroundingForIdeas(brand: Brand): string {
  const lines: string[] = [];
  const lab = brand.facts?.lab === true;
  const niche =
    typeof brand.facts?.differentiators === "string" ? brand.facts.differentiators.trim() : "";
  if (niche) {
    lines.push(`Niche / differentiators on file: ${niche}`);
  } else if (!lab && brand.name?.trim()) {
    lines.push(`Business name: ${brand.name.trim()}`);
  } else if (lab) {
    lines.push(
      "Lab chat: niche not locked yet — still deliver concrete post directions from prefs and general local-business craft. Do not ask what kind of business they are.",
    );
  }
  if (brand.website?.trim()) lines.push(`Website: ${brand.website.trim()}`);
  const prefs = brand.facts?.kip_preferences?.slice(-6) ?? [];
  if (prefs.length) {
    lines.push(`Owner preferences: ${prefs.map((p) => p.text).filter(Boolean).join("; ")}`);
  }
  const ctx = brandContextForPrompt(brand).trim();
  if (ctx) lines.push(`Strategy context:\n${ctx.slice(0, 800)}`);
  return lines.join("\n").trim();
}

/** Deterministic ideas when research + LLM yield nothing — never interview. */
export function fallbackContentIdeas(brand: Brand, count: number): ScoutIdea[] {
  const niche =
    typeof brand.facts?.differentiators === "string" ? brand.facts.differentiators.trim() : "";
  const lab = brand.facts?.lab === true;
  const label = niche || (!lab ? brand.name?.trim() : "") || "your business";
  const pool: ScoutIdea[] = [
    {
      title: "Craft close-up",
      angle: `A photo-led feed post that shows the work behind ${label} — one specific detail, not a vague vibe shot`,
      format: "feed",
      why: "Gives people a reason to care without inventing a fake win",
    },
    {
      title: "This week invite",
      angle: `A short LinkedIn-friendly note on who ${label} is for and one clear next step (DM / book / drop in)`,
      format: "feed",
      why: "Turns awareness into a simple action",
    },
    {
      title: "Myth vs reality carousel",
      angle: `3 slides that correct a common misconception in your lane — slide 1 myth, slide 2 what actually matters, slide 3 how you handle it`,
      format: "carousel",
      why: "Carousels teach fast and travel well when niche memory is thin",
    },
    {
      title: "Owner POV",
      angle: `A first-person take on one decision you made for ${label} this month and what you'd tell a peer`,
      format: "feed",
      why: "Sounds human and stays on-brand without competitor research",
    },
    {
      title: "Proof without fluff",
      angle: `Show a real process moment (prep, setup, aftercare) with a caption that names the craft, not invented awards`,
      format: "feed",
      why: "Builds trust when the proof bank is empty",
    },
    {
      title: "Soft hiring / help ask",
      angle: `If growth is on your mind: a professional open role or "who should we meet" post with clear requirements`,
      format: "feed",
      why: "Useful anytime — swap the role once niche is locked",
    },
  ];
  return pool.slice(0, Math.min(6, Math.max(3, count)));
}

/** SMS rundown from scout ideas — no intake questions. */
export function formatIdeasSms(ideas: ScoutIdea[], note?: string): string {
  const bits = ideas.slice(0, 4).map((idea, i) => {
    const fmt = idea.format && idea.format !== "feed" ? ` (${idea.format})` : "";
    return `${i + 1}. ${idea.title}${fmt} — ${idea.angle}`;
  });
  let out = bits.join(" ");
  const caveat = (note ?? "").trim();
  if (caveat && !/[?？]/.test(caveat) && !/\b(are you|tell me|what(?:'?s| is) your)\b/i.test(caveat)) {
    out += ` ${caveat}`;
  }
  out += " Want me to draft one of these?";
  return out;
}

/**
 * Ensure we have a usable research bank, refreshing via runDeepResearch when thin
 * or when the owner clearly asked to look into competitors / the niche.
 */
export async function ensureIdeaResearchBank(
  brand: Brand,
  focus: string,
): Promise<{ bank: IdeaResearchBank; refreshed: boolean }> {
  const initial = await gatherIdeaResearchBank(brand.id);
  const wantsFresh =
    initial.thin ||
    /\b(competitor|rival|ad library|look into|research|what.?s working|spy on|scope out)\b/i.test(
      focus,
    );

  if (!wantsFresh) {
    return { bank: initial, refreshed: false };
  }

  const researchFocus = resolveScoutFocus(focus, initial.watchNames);
  const watchHint = initial.watchNames.length
    ? ` Watched competitors on file: ${initial.watchNames.join(", ")}.`
    : "";
  const request =
    (focus.trim() ||
      "Scout content ideas for this brand — what competitors and the niche are doing on organic + Meta Ad Library.") +
    watchHint;

  await runDeepResearch(brand, researchFocus, request.slice(0, 1500));
  const bank = await gatherIdeaResearchBank(brand.id);
  return { bank, refreshed: true };
}

function parseIdeasJson(raw: string, count: number): { ideas: ScoutIdea[]; note?: string } {
  const cleaned = stripMarkdown(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { ideas: [] };
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    ideas?: Array<{
      title?: string;
      angle?: string;
      format?: string;
      why?: string;
      inspired_by?: string;
    }>;
    note?: string;
  };
  const ideas = (parsed.ideas ?? [])
    .map((idea) => ({
      title: String(idea.title ?? "").trim(),
      angle: String(idea.angle ?? "").trim(),
      format: String(idea.format ?? "feed").trim() || "feed",
      why: String(idea.why ?? "").trim(),
      inspired_by: String(idea.inspired_by ?? "").trim() || undefined,
    }))
    .filter((idea) => idea.title && idea.angle)
    .slice(0, count);
  return {
    ideas,
    note: String(parsed.note ?? "").trim() || undefined,
  };
}

/**
 * Scout concrete post ideas grounded in competitor / niche research already on file
 * (refreshing that research when thin). Does not draft or publish.
 * Always returns ideas when possible — never an interview prompt.
 */
export async function scoutContentIdeas(
  brand: Brand,
  opts: { focus?: string; count?: number; retrievedPack?: string } = {},
): Promise<ScoutContentIdeasResult> {
  const count = Math.min(6, Math.max(3, Math.floor(opts.count ?? 4)));
  const focus = (opts.focus ?? "").trim().slice(0, 400);
  const grounding = brandGroundingForIdeas(brand);

  try {
    const { bank, refreshed } = await ensureIdeaResearchBank(brand, focus);
    const system = [
      ...personaVoiceLines(brand),
      brandTalkingIdentity(brand),
      "Turn competitor / niche research into concrete social content ideas for this owner.",
      "Lean hard on the research bank: competitor hooks, Ad Library angles, organic themes, pain language, outlier angles. Do not invent fake ads or reviews.",
      "Prefer angles that one-up or answer what rivals are doing — not copycat clones.",
      "If the research bank is thin: still return concrete ideas from brand grounding / prefs. Never ask clarifying niche questions. Never put a question in note.",
      `Return ONLY JSON: {"ideas":[{"title":"<short>","angle":"<1 line>","format":"feed|carousel|reel|story","why":"<one SMS line why it fits their niche>","inspired_by":"<optional: which competitor hook / ad angle / theme>"}],"note":"<optional 1-line niche caveat, never a question>"}`,
      `Exactly ${count} ideas.`,
      `Research bank:\n${bank.text.slice(0, 3500)}`,
      grounding ? `Brand grounding:\n${grounding.slice(0, 1200)}` : "",
      opts.retrievedPack ? `Brand context:\n${opts.retrievedPack.slice(0, 1500)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await callLLM({
      system,
      messages: [
        {
          role: "user",
          content: focus
            ? `Focus: ${focus}\nGive ${count} concrete post ideas grounded in that research bank.`
            : `Give ${count} concrete post ideas grounded in that competitor / niche research bank.`,
        },
      ],
      maxTokens: 700,
      temperature: 0.55,
      // Research already searched the web; keep a light pass for timeliness only.
      webSearch: bank.thin ? 3 : 2,
      tier: "smart",
      task: "scout_ideas",
    });

    const { ideas, note } = parseIdeasJson(raw, count);
    const finalIdeas = ideas.length > 0 ? ideas : fallbackContentIdeas(brand, count);
    const safeNote =
      note && !/[?？]/.test(note) && !/\b(are you|tell me|what(?:'?s| is) your)\b/i.test(note)
        ? note
        : bank.thin
          ? "Research bank is still thin — these are solid starter directions."
          : undefined;
    return {
      ok: true,
      ideas: finalIdeas,
      note: safeNote,
      researchRefreshed: refreshed,
      bankChars: bank.text.length,
    };
  } catch {
    // Soft-fail into usable ideas so the owner never gets an intake quiz.
    return {
      ok: true,
      ideas: fallbackContentIdeas(brand, count),
      note: "Hit a snag on research — here are solid starter directions anyway.",
      researchRefreshed: false,
      bankChars: 0,
    };
  }
}
