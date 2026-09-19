/**
 * Content-idea scout — reuses deep research + competitor watches/snapshots
 * instead of a parallel free-form web search. Mush: list what we already know,
 * refresh via runDeepResearch when thin, then synthesise post ideas from that bank.
 */

import type { Brand, ResearchFindings, ResearchSnapshot } from "@pulse/shared";
import { brandVoiceProfileSchema, query } from "@pulse/shared";
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
export function brandGroundingForIdeas(brand: Brand, recentTopics: string[] = []): string {
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
      "Lab chat: niche not locked yet — still deliver concrete post directions from prefs, voice, and recent drafts. Do not ask what kind of business they are.",
    );
  }
  if (brand.website?.trim()) lines.push(`Website: ${brand.website.trim()}`);
  const prefs = brand.facts?.kip_preferences?.slice(-6) ?? [];
  if (prefs.length) {
    lines.push(`Owner preferences: ${prefs.map((p) => p.text).filter(Boolean).join("; ")}`);
  }
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  if (profile.tone.length) lines.push(`Voice tone: ${profile.tone.join(", ")}`);
  const ctx = brandContextForPrompt(brand).trim();
  if (ctx) lines.push(`Strategy context:\n${ctx.slice(0, 800)}`);
  if (recentTopics.length) {
    lines.push(`Recent draft / post topics (reuse these lanes, do not invent a new business type): ${recentTopics.join("; ")}`);
  }
  return lines.join("\n").trim();
}

/** Recent captions so thin-research scouts stay on the owner's actual topics. */
export async function recentPostTopics(brandId: string, limit = 5): Promise<string[]> {
  const rows = await query<{ caption: string | null }>(
    `select caption
       from posts
      where brand_id = $1
        and caption is not null
        and length(trim(caption)) > 20
      order by created_at desc
      limit $2`,
    [brandId, Math.min(8, Math.max(1, limit))],
  );
  return rows
    .map((r) => (r.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 90))
    .filter(Boolean);
}

function clipAngle(text: string, max = 72): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 40 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** Deterministic ideas when research + LLM yield nothing — never interview. */
export function fallbackContentIdeas(brand: Brand, count: number, recentTopics: string[] = []): ScoutIdea[] {
  const niche =
    typeof brand.facts?.differentiators === "string" ? brand.facts.differentiators.trim() : "";
  const lab = brand.facts?.lab === true;
  const topicHint = recentTopics[0]?.replace(/\s+/g, " ").trim();
  const label = niche || (!lab ? brand.name?.trim() : "") || (topicHint ? "that lane" : "the work");
  const pool: ScoutIdea[] = [
    {
      title: "Craft close-up",
      angle: topicHint
        ? `Photo of the craft behind: ${clipAngle(topicHint, 48)}`
        : `One sharp detail of ${label} — not a vague vibe shot`,
      format: "feed",
      why: "Specific beats generic",
    },
    {
      title: "This week invite",
      angle: `Who ${label} is for + one clear next step`,
      format: "feed",
      why: "Turns awareness into action",
    },
    {
      title: "Myth vs reality",
      angle: `3-slide carousel: myth, what matters, how you handle it`,
      format: "carousel",
      why: "Teaches fast when research is thin",
    },
    {
      title: "Owner POV",
      angle: `One decision this month for ${label} and what you'd tell a peer`,
      format: "feed",
      why: "Human without invented proof",
    },
    {
      title: "Process proof",
      angle: `Show prep / setup / aftercare — name the craft, skip fake awards`,
      format: "feed",
      why: "Trust when the proof bank is empty",
    },
    {
      title: "Help wanted",
      angle: `Professional open-role or "who should we meet" with clear requirements`,
      format: "feed",
      why: "Useful anytime — swap the role later",
    },
  ];
  return pool.slice(0, Math.min(6, Math.max(3, count)));
}

/**
 * SMS rundown from scout ideas — short enough for one/two clean bubbles.
 * No intake questions. No "research is thin" caveats in owner SMS.
 */
export function formatIdeasSms(ideas: ScoutIdea[], _note?: string): string {
  const bits = ideas.slice(0, 3).map((idea, i) => {
    const fmt = idea.format && idea.format !== "feed" ? ` (${idea.format})` : "";
    return `${i + 1}. ${clipAngle(idea.title, 28)}${fmt}: ${clipAngle(idea.angle, 64)}.`;
  });
  return `${bits.join(" ")} Want me to draft one?`;
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
  const recentTopics = await recentPostTopics(brand.id).catch(() => [] as string[]);
  const grounding = brandGroundingForIdeas(brand, recentTopics);

  try {
    const { bank, refreshed } = await ensureIdeaResearchBank(brand, focus);
    const system = [
      ...personaVoiceLines(brand),
      brandTalkingIdentity(brand),
      "Turn competitor / niche research into concrete social content ideas for this owner.",
      "Lean hard on the research bank: competitor hooks, Ad Library angles, organic themes, pain language, outlier angles. Do not invent fake ads or reviews.",
      "Prefer angles that one-up or answer what rivals are doing — not copycat clones.",
      "Keep each title under 6 words and each angle under 12 words — these go out as SMS.",
      "If the research bank is thin: still return concrete ideas from brand grounding / recent draft topics / prefs. Never ask clarifying niche questions. Never put a question in note. Leave note empty unless there is a real non-question caveat.",
      `Return ONLY JSON: {"ideas":[{"title":"<short>","angle":"<1 short line>","format":"feed|carousel|reel|story","why":"<few words>","inspired_by":"<optional>"}],"note":""}`,
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
    const finalIdeas =
      ideas.length > 0 ? ideas : fallbackContentIdeas(brand, count, recentTopics);
    const safeNote =
      note && !/[?？]/.test(note) && !/\b(are you|tell me|what(?:'?s| is) your|research bank is still thin)\b/i.test(note)
        ? note
        : undefined;
    return {
      ok: true,
      ideas: finalIdeas.map((idea) => ({
        ...idea,
        title: clipAngle(idea.title, 36),
        angle: clipAngle(idea.angle, 72),
      })),
      note: safeNote,
      researchRefreshed: refreshed,
      bankChars: bank.text.length,
    };
  } catch {
    // Soft-fail into usable ideas so the owner never gets an intake quiz.
    return {
      ok: true,
      ideas: fallbackContentIdeas(brand, count, recentTopics),
      note: undefined,
      researchRefreshed: false,
      bankChars: 0,
    };
  }
}
