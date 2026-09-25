/**
 * Wave 1 brand-context retrieval for Kip.
 * Keyword overlap + recency only (no embeddings / pgvector). Never invents facts.
 */

import { brandVoiceProfileSchema, query, queryOne, type Brand, type Post } from "@pulse/shared";
import { brandContextForPrompt } from "./brandContext.js";
import { factsForPrompt } from "./businessProfile.js";
import { formatBrandKitLine, formatMarketVisualsLine } from "./brandElements.js";
import { kipMemoryPromptBlock, readKipDecisions, readKipPreferences } from "./kipMemory.js";
import { bankedPhotoCount } from "./library.js";
import { formatOfferedDraftBlock } from "./offeredDraft.js";
import { connectionSummary } from "./persona.js";
import { formatScheduledSlot } from "./smsTime.js";
import { openLoopsPromptBlock, readOpenLoops } from "./speak/openLoops.js";

export type BrandContextPack = {
  text: string;
  sections: string[];
  chars: number;
};

const MAX_PACK_CHARS = 4000;
const NONE = "(none)";
const SECTION_ORDER = [
  "prefs",
  "facts",
  "strategy",
  "engine",
  "openLoops",
  "voice",
  "tone",
  "campaigns",
] as const;

type SectionName = (typeof SECTION_ORDER)[number];

const SECTION_HEADING: Record<SectionName, string> = {
  prefs: "Preferences",
  facts: "Business facts",
  strategy: "Strategy",
  engine: "Engine",
  openLoops: "Open loops",
  voice: "Voice",
  tone: "Tone examples",
  campaigns: "Past campaigns",
};

/** Tokenize query/candidate text: lowercase, split on non-letters, drop words shorter than 3. */
function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Rank candidate strings by keyword overlap with queryText.
 * Ties broken by recency (`at` descending). Pure helper for tests.
 */
export function rankByKeywordOverlap(
  queryText: string,
  items: Array<{ text: string; at?: string | null }>,
  limit: number,
): Array<{ text: string; score: number }> {
  const cap = Math.max(0, Math.floor(limit));
  const queryTokens = [...new Set(tokenizeQuery(queryText))];
  const scored = items.map((item, index) => {
    const itemSet = new Set(tokenizeQuery(item.text));
    const score = queryTokens.reduce((n, tok) => n + (itemSet.has(tok) ? 1 : 0), 0);
    return { text: item.text, score, atMs: recencyMs(item.at), index };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.atMs !== a.atMs) return b.atMs - a.atMs;
    return a.index - b.index;
  });
  return scored.slice(0, cap).map(({ text, score }) => ({ text, score }));
}

function recencyMs(at?: string | null): number {
  if (!at) return 0;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

function orNone(text: string): string {
  const t = text.trim();
  return t || NONE;
}

function excerpt(caption: string | null | undefined, max = 80): string {
  const t = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(no caption)";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function compactList(items: string[], max = 8): string {
  return items
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max)
    .join("; ");
}

function formatVoice(brand: Brand): string {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const lines: string[] = [];
  if (profile.tone.length) lines.push(`Tone: ${profile.tone.join(", ")}`);
  if (profile.dos.length) lines.push(`Do: ${compactList(profile.dos)}`);
  if (profile.donts.length) lines.push(`Don't: ${compactList(profile.donts)}`);
  if (profile.banned_words.length) lines.push(`Banned words: ${compactList(profile.banned_words, 20)}`);
  lines.push(`Emoji: ${profile.emoji_policy}`);
  if (profile.hashtag_policy.trim()) lines.push(`Hashtags: ${profile.hashtag_policy.trim()}`);

  const m = profile.writing_mechanics;
  const mech: string[] = [];
  if (m.emoji_frequency) mech.push(`emoji ${m.emoji_frequency}`);
  if (m.favourite_emojis.length) mech.push(`fav emojis ${m.favourite_emojis.slice(0, 6).join(" ")}`);
  if (m.exclamation_usage) mech.push(`exclamations ${m.exclamation_usage}`);
  if (m.ellipsis_usage) mech.push(`ellipses ${m.ellipsis_usage}`);
  if (m.capitalisation) mech.push(`caps ${m.capitalisation}`);
  if (m.sentence_length) mech.push(`sentences ${m.sentence_length}`);
  if (m.punctuation_quirks.length) mech.push(`punct ${m.punctuation_quirks.slice(0, 4).join("; ")}`);
  if (m.openers.length) mech.push(`openers ${m.openers.slice(0, 3).join(" / ")}`);
  if (m.sign_offs.length) mech.push(`sign-offs ${m.sign_offs.slice(0, 3).join(" / ")}`);
  if (m.hashtag_style) mech.push(`hashtag style ${m.hashtag_style}`);
  if (m.cta_style) mech.push(`cta ${m.cta_style}`);
  if (m.favourite_phrases.length) mech.push(`phrases ${m.favourite_phrases.slice(0, 4).join("; ")}`);
  if (mech.length) lines.push(`Writing: ${mech.join("; ")}`);

  return orNone(lines.join("\n"));
}

function formatPrefs(brand: Brand): string {
  const prefs = readKipPreferences(brand.facts);
  const decisions = readKipDecisions(brand.facts);
  if (!prefs.length && !decisions.length) return NONE;
  return orNone(kipMemoryPromptBlock(brand.facts));
}

function formatFacts(brand: Brand): string {
  const facts = factsForPrompt(brand.facts);
  if (!facts || facts.startsWith("(no business")) return NONE;
  return facts;
}

function formatStrategy(brand: Brand): string {
  // Empty ICP/offers stay empty — never invent a customer or discount.
  return orNone(brandContextForPrompt(brand));
}

function engagementSum(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const e = raw as Record<string, unknown>;
  const n = (...keys: string[]) => {
    for (const k of keys) {
      const v = Number(e[k] ?? 0);
      if (Number.isFinite(v) && v) return v;
    }
    return 0;
  };
  return n("likes", "like_count") + n("comments", "comment_count") + n("saves", "saved") + n("shares", "sends", "shares_count");
}

async function safeQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    return await query<T>(sql, params);
  } catch {
    return [];
  }
}

async function safeQueryOne<T>(sql: string, params: unknown[]): Promise<T | null> {
  try {
    return await queryOne<T>(sql, params);
  } catch {
    return null;
  }
}

type KickoffRow = { kind: string };
type TonePostRow = {
  caption: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at?: string | null;
};
type DesignNoteRow = { notes: string | null; created_at: string | null };
type CampaignRow = { name: string | null; goal: string | null; status: string | null; created_at: string | null };
type PublishedPostRow = {
  caption: string | null;
  engagement: Record<string, unknown> | null;
  published_at: string | null;
  created_at?: string | null;
};

type UpcomingRow = { scheduled_at: string; caption: string | null; status: string };

async function formatEngine(brand: Brand): Promise<string> {
  const [photoCount, pending, kickoffs, upcoming, proposedPlan, strategyBrief, proposedCampaign, exemplars] =
    await Promise.all([
    bankedPhotoCount(brand.id).catch(() => 0),
    safeQueryOne<Post>(
      `select * from posts
        where brand_id = $1 and status = 'pending_approval'
        order by coalesce(last_offered_at, created_at) desc, created_at desc
        limit 1`,
      [brand.id],
    ),
    safeQuery<KickoffRow>(
      `select kind from kip_kickoffs
        where brand_id = $1 and status in ('queued','running')`,
      [brand.id],
    ),
    safeQuery<UpcomingRow>(
      `select scheduled_at, caption, status
         from posts
        where brand_id = $1
          and status = any($2::text[])
          and scheduled_at is not null
          and scheduled_at >= now()
        order by scheduled_at asc
        limit 4`,
      [brand.id, ["pending_approval", "approved", "scheduled"]],
    ),
    safeQueryOne<{ id: string }>(
      `select id from content_plans where brand_id = $1 and status = 'proposed' order by created_at desc limit 1`,
      [brand.id],
    ),
    safeQueryOne<{ id: string }>(
      `select id from strategy_briefs where brand_id = $1 and status = 'proposed' order by created_at desc limit 1`,
      [brand.id],
    ),
    safeQueryOne<{ id: string }>(
      `select id from campaigns where brand_id = $1 and status = 'proposed' order by created_at desc limit 1`,
      [brand.id],
    ),
    safeQuery<{
      label?: string | null;
      notes?: string | null;
      competitor_name?: string | null;
      source?: string | null;
    }>(
      `select label, notes, competitor_name, source
         from visual_exemplars
        where brand_id = $1
        order by created_at desc
        limit 3`,
      [brand.id],
    ),
  ]);

  const lines: string[] = [];
  const n = Number(photoCount) || 0;
  if (n > 0) {
    lines.push(
      `Library: ${n} unused owner photo${n === 1 ? "" : "s"}. Prefer from_library or pass media_ids instead of generating, unless they asked for generated/stock or this brief needs a scene they did not shoot.`,
    );
  } else {
    lines.push("Library: 0 photos on file.");
  }

  if (pending?.id) {
    lines.push(formatOfferedDraftBlock(pending));
  } else {
    lines.push(`Pending draft: ${NONE}`);
  }

  const confirms: string[] = [];
  if (pending?.id) {
    confirms.push(
      "A draft is in front of them. Bare yes publishes that draft, not a plan, link, or campaign.",
    );
  }
  if (proposedPlan) {
    confirms.push(
      "Proposed content plan waiting — accept applies pillars only (no first_batch). Use confirm_pending_ask.",
    );
  }
  const pendingLink = brand.facts?.pending_destination_link;
  if (pendingLink && typeof pendingLink === "object" && pendingLink !== null && "url" in pendingLink) {
    confirms.push(
      `Booking link waiting to confirm (${String((pendingLink as { url?: string }).url ?? "")}). Confirm-before-save. Use confirm_pending_ask. Do not let a booking yes publish a post.`,
    );
  }
  if (strategyBrief) {
    confirms.push("Proposed strategy brief waiting. Use confirm_pending_ask.");
  }
  if (proposedCampaign) {
    confirms.push("Proposed organic campaign waiting. Use confirm_pending_ask. No ad spend.");
  }
  const perf = (brand.facts as { kip_perf_pending?: { summary?: string } } | null)?.kip_perf_pending;
  if (perf) {
    confirms.push(
      `Perf suggestion waiting (${perf.summary ?? "mix"}). Use confirm_pending_ask. Do not publish a feed post.`,
    );
  }
  lines.push(
    confirms.length ? `Last confirm asked: ${confirms.join(" ")}` : `Last confirm asked: ${NONE}`,
  );

  const visuals = brand.visual?.preferred_visuals;
  lines.push(visuals ? `Preferred visuals: ${visuals}` : `Preferred visuals: ${NONE}`);
  lines.push(formatBrandKitLine(brand.visual));
  const market = formatMarketVisualsLine(exemplars);
  if (market) lines.push(market);

  const kinds = kickoffs.map((k) => String(k.kind ?? "").trim()).filter(Boolean);
  lines.push(kinds.length ? `In-flight kickoffs: ${kinds.join(", ")}` : `In-flight kickoffs: ${NONE}`);

  if (upcoming.length) {
    const bits = upcoming.map((p) => {
      const when = formatScheduledSlot(new Date(p.scheduled_at));
      return `${when} ${excerpt(p.caption, 40)} (${p.status})`;
    });
    lines.push(`Upcoming: ${bits.join("; ")}`);
  } else {
    lines.push(`Upcoming: ${NONE}`);
  }

  lines.push(`Connected: ${connectionSummary(brand)}`);
  return lines.join("\n");
}

function formatOpenLoops(brand: Brand): string {
  return orNone(openLoopsPromptBlock(readOpenLoops(brand)));
}

function matchingLines(
  queryText: string,
  items: Array<{ text: string; at?: string | null }>,
  limit: number,
): string[] {
  const ranked = rankByKeywordOverlap(queryText, items, limit);
  return ranked.filter((r) => r.score > 0 && r.text.trim()).map((r) => r.text.trim());
}

async function formatToneExamples(brandId: string, queryText: string): Promise<string> {
  const [posts, notes] = await Promise.all([
    safeQuery<TonePostRow>(
      `select caption, scheduled_at, published_at, created_at
         from posts
        where brand_id = $1 and status in ('approved','published')
        order by coalesce(published_at, scheduled_at, created_at) desc nulls last
        limit 15`,
      [brandId],
    ),
    safeQuery<DesignNoteRow>(
      `select notes, created_at
         from design_memory
        where brand_id = $1
        order by created_at desc
        limit 8`,
      [brandId],
    ),
  ]);

  const postItems = posts
    .map((p) => ({
      text: excerpt(p.caption, 160),
      at: p.published_at ?? p.scheduled_at ?? p.created_at ?? null,
    }))
    .filter((p) => p.text && p.text !== "(no caption)");
  const topPosts = matchingLines(queryText, postItems, 3);

  const noteItems = notes
    .map((n) => ({
      text: (n.notes ?? "").replace(/\s+/g, " ").trim(),
      at: n.created_at ?? null,
    }))
    .filter((n) => n.text);
  const topNotes = matchingLines(queryText, noteItems, 2).map((t) => excerpt(t, 120));

  const lines: string[] = [];
  if (topPosts.length) {
    for (const c of topPosts) lines.push(`- ${c}`);
  }
  if (topNotes.length) {
    lines.push("Design notes:");
    for (const n of topNotes) lines.push(`- ${n}`);
  }
  return orNone(lines.join("\n"));
}

async function formatPastCampaigns(brandId: string, queryText: string): Promise<string> {
  let campaignRows: CampaignRow[] | null = null;
  try {
    campaignRows = await query<CampaignRow>(
      `select name, goal, status, created_at
         from campaigns
        where brand_id = $1
        order by created_at desc
        limit 12`,
      [brandId],
    );
  } catch {
    campaignRows = null;
  }

  if (campaignRows) {
    const items = campaignRows.map((c) => {
      const name = (c.name ?? "").trim() || "Campaign";
      const goal = (c.goal ?? "").replace(/\s+/g, " ").trim();
      const status = (c.status ?? "").trim();
      const text = [name, status && `(${status})`, goal].filter(Boolean).join(" ");
      return { text, at: c.created_at ?? null };
    });
    const ranked = rankByKeywordOverlap(queryText, items, 3).filter((r) => r.text.trim());
    const picked = ranked.some((r) => r.score > 0)
      ? ranked.filter((r) => r.score > 0)
      : items.slice(0, 3).map((r) => ({ text: r.text, score: 0 }));
    if (!picked.length) return NONE;
    return picked.map((r) => `- ${r.text}`).join("\n");
  }

  const published = await safeQuery<PublishedPostRow>(
    `select caption, engagement, published_at, created_at
       from posts
      where brand_id = $1 and status = 'published'
      order by published_at desc nulls last
      limit 20`,
    [brandId],
  );
  const scored = published
    .map((p) => ({
      text: excerpt(p.caption, 120),
      score: engagementSum(p.engagement),
      at: p.published_at ?? p.created_at ?? null,
    }))
    .filter((p) => p.text && p.text !== "(no caption)");
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return recencyMs(b.at) - recencyMs(a.at);
  });
  const top = scored.filter((p) => p.score > 0).slice(0, 3);
  if (!top.length) return NONE;
  return top.map((p) => `- ${p.text}`).join("\n");
}

function renderSections(bodies: Record<SectionName, string>): { text: string; sections: string[] } {
  const blocks = SECTION_ORDER.map((name) => `## ${SECTION_HEADING[name]}\n${bodies[name]}`);
  return { text: blocks.join("\n\n"), sections: [...SECTION_ORDER] };
}

function capPack(bodies: Record<SectionName, string>): { text: string; sections: string[] } {
  let assembled = renderSections(bodies);
  if (assembled.text.length <= MAX_PACK_CHARS) return assembled;

  const shrinkables: SectionName[] = ["tone", "campaigns", "strategy", "facts", "voice"];
  for (const name of shrinkables) {
    if (assembled.text.length <= MAX_PACK_CHARS) break;
    const others = renderSections({ ...bodies, [name]: NONE });
    const heading = `## ${SECTION_HEADING[name]}\n`;
    const room = MAX_PACK_CHARS - others.text.length + NONE.length;
    if (room < 8) {
      bodies[name] = NONE;
    } else {
      const body = bodies[name];
      bodies[name] = body.length <= room ? body : `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
    }
    assembled = renderSections(bodies);
  }

  if (assembled.text.length > MAX_PACK_CHARS) {
    assembled = { text: assembled.text.slice(0, MAX_PACK_CHARS), sections: assembled.sections };
  }
  return assembled;
}

/**
 * Assemble a capped brand-context pack: always-include working set + query-selected slices.
 * Empty sections get a short "(none)" line — never invent facts (no fake ICP, offers, etc.).
 * Does not call the conversation summarize LLM — recent SMS is chat history on the agent path.
 */
export async function retrieveBrandContext(brand: Brand, queryText: string): Promise<BrandContextPack> {
  const [engine, tone, campaigns] = await Promise.all([
    formatEngine(brand),
    formatToneExamples(brand.id, queryText),
    formatPastCampaigns(brand.id, queryText),
  ]);

  const bodies: Record<SectionName, string> = {
    prefs: formatPrefs(brand),
    facts: formatFacts(brand),
    strategy: formatStrategy(brand),
    engine,
    openLoops: formatOpenLoops(brand),
    voice: formatVoice(brand),
    tone,
    campaigns,
  };

  const packed = capPack(bodies);
  const chars = packed.text.length;
  console.log(JSON.stringify({ event: "retrieve", brandId: brand.id, sections: packed.sections, chars }));
  return { text: packed.text, sections: packed.sections, chars };
}
