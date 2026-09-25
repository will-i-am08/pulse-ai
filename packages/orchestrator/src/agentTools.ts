/**
 * Bounded Anthropic client tools for Smart Kip.
 * Calendar, analytics, scheduling, draft facade, escalate, remember.
 * Never publishes, never spends ads, never returns secrets/tokens.
 */

import { z } from "zod";
import {
  KipKickoffKind,
  brandVoiceProfileSchema,
  query,
  queryOne,
  Platform,
  PostFormat,
  type Brand,
  type KipKickoffKind as KipKickoffKindT,
  type MediaAsset,
  type Platform as PlatformT,
  type Post,
  type PostFormat as PostFormatT,
  type PostStatus,
} from "@pulse/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { brandContextForPrompt } from "./brandContext.js";
import { factsForPrompt } from "./businessProfile.js";
import { enqueueKickoff, inferDraftCount, looksLikeKickoffRequest, textWantsCarousel } from "./kickoffs.js";
import { extractPlatforms } from "./destinations.js";
import { isLinkedInPrimary } from "./contentJobs.js";
import {
  clampMemoryText,
  recordKipMemory,
  type KipMemoryBucket,
} from "./kipMemory.js";
import { connectionSummary } from "./persona.js";
import { scheduleSlot } from "./scheduler.js";
import { buildPerformanceAnalysis } from "./performanceDigest.js";
import { draftCaption } from "./draftCaption.js";
import { humanizeChat } from "./speak/humanizeChat.js";
import { formatScheduledSlot, formatWeekday, joinEnglish, localYmd } from "./smsTime.js";
import { draftPostFromPhoto, pickFreshPhoto } from "./library.js";
import { draftCarouselFromPhotos, draftStoryFromPhoto } from "./formats.js";
import { ensurePillars } from "./pillars.js";
import { queueUgcJob } from "./ugc/index.js";
import { queueAiVideoJob } from "./aiVideo.js";
import { scoutContentIdeas, formatIdeasSms } from "./ideaScout.js";
import { readKipPreferences } from "./kipMemory.js";
import {
  clearImageOverlay,
  formatOfferedDraftBlock,
  loadOfferedDraft,
  rejectOfferedDraft,
  restyleOfferedImage,
  reviseOfferedDraftCaption,
  setImageOverlay,
} from "./offeredDraft.js";
import { looksLikeApproval } from "./classify.js";
import { applyNichePlan, getProposedPlan } from "./nichePlan.js";
import {
  clearPendingDestinationLink,
  getPendingDestinationLink,
  handleDestinationLinkConfirmation,
} from "./destinationLinks.js";
import {
  acceptStrategyPieces,
  cancelStrategyBrief,
  getProposedStrategyBrief,
  parseStrategyAccept,
} from "./strategyBrief.js";
import { activateCampaign, getProposedCampaign } from "./campaigns.js";
import { clearPerfPending, confirmPerfSuggestion } from "./performanceActions.js";

export type AgentToolContext = {
  brand: Brand;
  sourceMessageId?: string | null;
  /** Raw owner SMS/Lab text for this turn (platform names may be stripped from tool briefs). */
  ownerMessage?: string | null;
  mediaIds?: string[];
  retrievedPack?: string;
  notifyOperator?: (body: string) => Promise<boolean | void>;
  operatorAlerts?: string[];
  /** Last preview URL from a draft mutation tool (for MMS). */
  lastMediaUrl?: { url?: string | null };
};

export type { KipMemoryBucket };
export { clampMemoryText, mergeKipMemoryFact, recordKipMemory } from "./kipMemory.js";

const CALENDAR_STATUSES: PostStatus[] = ["pending_approval", "approved", "scheduled"];
const SCHEDULABLE_STATUSES: PostStatus[] = ["pending_approval", "approved", "scheduled"];

const DRAFT_COPY_JOBS = [
  "caption",
  "post",
  "first_batch",
  "carousel",
  "story",
  "trend",
  "competitor",
  "from_library",
  "ugc",
  "reel",
] as const;
type DraftCopyJob = (typeof DRAFT_COPY_JOBS)[number];

const ESCALATE_REASONS = [
  "blocked",
  "policy",
  "spend",
  "complaint",
  "unclear",
  "out_of_scope",
] as const;

const KICKOFF_NOTE = "Queued for drafting only — never auto-publishes. Owner still approves.";

const schedulePostInputSchema = z
  .object({
    post_id: z
      .string()
      .optional()
      .describe("Post UUID to schedule. Defaults to the latest pending/approved/scheduled post."),
    when: z
      .string()
      .optional()
      .describe("next_slot (default) or a future ISO 8601 datetime. Never publishes."),
    platform: z
      .enum(Platform)
      .optional()
      .describe("Destination platform (default instagram)."),
  })
  .strict();

const pullAnalyticsInputSchema = z
  .object({
    days: z
      .number()
      .optional()
      .describe("Unused — analysis already uses the last 30 published posts."),
  })
  .strict();

const checkCalendarInputSchema = z
  .object({
    days: z.number().optional().describe("Horizon in days (default 10, min 7, max 14)."),
  })
  .strict();

const draftCopyInputSchema = z
  .object({
    job: z.enum(DRAFT_COPY_JOBS).describe("Which content-engine job to run."),
    brief: z
      .string()
      .optional()
      .describe(
        "Optional brief or instructions. Keep platform names (LinkedIn, Instagram, TikTok, …) when the owner named them. Generated photos default to shot-on-iPhone; if this piece should look more professional or studio, say so here from brand facts, voice, or the ask — do not map a niche to a look. On-image type: set overlay none or headline to this brand's language (repeat it; do not randomize). If they named an exact overlay headline, put it in overlay_headline or write it here verbatim. Brand elements: set elements none or mark or constructed to this brand's language (repeat it; do not randomize). Ground the pick in pack research, remembered likes, and visual tokens — not a café=template table.",
      ),
    count: z
      .number()
      .optional()
      .describe(
        "How many drafts to queue. If omitted, inferred from the owner's wording (e.g. \"a post\" → 1, \"draft me 3\" → 3).",
      ),
    format: z.enum(PostFormat).optional().describe("Post format hint."),
    visuals: z
      .enum(["photo", "designed", "stock", "generated"])
      .optional()
      .describe("Visual mode for queued drafts. constructed brand-elements language generates a photo unless the brief is graphics-only."),
    overlay: z
      .enum(["none", "headline"])
      .optional()
      .describe(
        "On-image type for THIS brand, repeated on every draft. none = clean photo; headline = burn a line. Pick from brand facts, voice, lasting prefs, and on-image design rules — not a café/tech table, not a new roll each post. Omit only if the brief already says overlay:none / no overlay / an exact headline.",
      ),
    overlay_tone: z
      .enum(["quiet", "shouty"])
      .optional()
      .describe(
        "House loudness for this brand when overlay is headline: quiet = one short bottom-band line; shouty = punchy stacked poster. Pick once from facts/voice/design rules (skip shouty-centre if this brand is mostly action/motion). Repeat it. Default shouty if omitted.",
      ),
    overlay_headline: z
      .string()
      .optional()
      .describe("Exact words to burn when overlay is headline, or when the owner named the line. Do not invent a shorter substitute."),
    elements: z
      .enum(["none", "mark", "constructed"])
      .optional()
      .describe(
        "Brand-kit language for THIS brand, repeated on every draft. none = photo-led, no extra stamp; mark = add logo (or wordmark if no logo_url); constructed = palette/type/mark on a generated photo unless they asked for graphics-only cards. Pick from competitor/market research in the pack, remembered likes, and visual tokens — not a café/tech table, not a new roll each post.",
      ),
    media_ids: z.array(z.string()).optional().describe("Media asset ids to use."),
    topic_hint: z
      .string()
      .optional()
      .describe(
        "Topic hint for queued drafts. Keep platform names (LinkedIn, Instagram, …) when the owner named them.",
      ),
  })
  .strict();

const escalateInputSchema = z
  .object({
    reason: z.enum(ESCALATE_REASONS).describe("Why Kip cannot proceed."),
    summary: z.string().min(1).describe("Short summary of the situation for the operator."),
  })
  .strict();

const rememberFactInputSchema = z
  .object({
    text: z.string().describe("Short preference or decision to remember."),
    bucket: z
      .enum(["kip_preferences", "kip_decisions"])
      .optional()
      .describe("Where to store it (default kip_preferences)."),
  })
  .strict();

const confirmPendingAskInputSchema = z
  .object({
    action: z
      .enum(["accept", "reject"])
      .describe("Accept or reject the last confirm you asked (plan, booking link, strategy, organic campaign, perf mix). Never publishes a post. Never spends ads."),
    kind: z
      .enum(["auto", "plan", "booking_link", "strategy", "campaign", "perf"])
      .optional()
      .describe("Which parked confirm to resolve. Default auto = the last one on file."),
  })
  .strict();

const scoutIdeasInputSchema = z
  .object({
    focus: z
      .string()
      .optional()
      .describe("Optional topic, angle, or question to research for ideas."),
    count: z.number().optional().describe("How many ideas (default 4, min 3, max 6)."),
  })
  .strict();

const getOfferedDraftInputSchema = z.object({}).strict();

const reviseCaptionInputSchema = z
  .object({
    instruction: z.string().min(1).describe("How to change the CAPTION (feed copy), not image overlay."),
    post_id: z.string().optional().describe("Defaults to the current offered pending draft."),
  })
  .strict();

const setImageTextInputSchema = z
  .object({
    enabled: z.boolean().describe("false = strip overlay / restore clean source; true = burn headline on image."),
    headline: z.string().optional().describe("Optional overlay headline when enabled is true."),
    post_id: z.string().optional().describe("Defaults to the current offered pending draft."),
  })
  .strict();

const restyleImageInputSchema = z
  .object({
    instruction: z.string().min(1).describe("How to restyle the PHOTO (brighter, different vibe, etc.)."),
    post_id: z.string().optional().describe("Defaults to the current offered pending draft."),
  })
  .strict();

const regenerateCreativeInputSchema = z
  .object({
    brief: z.string().optional().describe("Optional new brief / topic for a fresh creative."),
    post_id: z.string().optional().describe("Defaults to the current offered pending draft (rejected first)."),
  })
  .strict();

const rejectDraftInputSchema = z
  .object({
    note: z.string().optional().describe("Optional reason for the audit log."),
    post_id: z.string().optional().describe("Defaults to the current offered pending draft."),
  })
  .strict();

type ZodDef = {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  values?: string[];
  description?: string;
  options?: z.ZodTypeAny[];
};

function defOf(schema: z.ZodTypeAny): ZodDef {
  return schema._def as ZodDef;
}

function unwrapZod(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean; description?: string } {
  let optional = false;
  let description: string | undefined;
  let cur: z.ZodTypeAny = schema;
  for (let i = 0; i < 8; i++) {
    const d = defOf(cur);
    description = description ?? cur.description ?? d.description;
    const typeName = d.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodNullable") {
      optional = true;
      cur = d.innerType ?? cur;
      continue;
    }
    if (typeName === "ZodEffects" && d.schema) {
      cur = d.schema;
      continue;
    }
    break;
  }
  const innerDef = defOf(cur);
  description = description ?? cur.description ?? innerDef.description;
  return { inner: cur, optional, description };
}

function emitJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { inner, description } = unwrapZod(schema);
  const d = defOf(inner);
  const typeName = d.typeName;
  let json: Record<string, unknown>;
  switch (typeName) {
    case "ZodString":
      json = { type: "string" };
      break;
    case "ZodNumber":
      json = { type: "number" };
      break;
    case "ZodBoolean":
      json = { type: "boolean" };
      break;
    case "ZodEnum":
      json = { type: "string", enum: d.values ?? [] };
      break;
    case "ZodArray":
      json = { type: "array", items: d.type ? emitJsonSchema(d.type) : {} };
      break;
    case "ZodObject":
      json = emitObjectSchema(inner as z.ZodObject<z.ZodRawShape>);
      break;
    default:
      json = {};
  }
  if (description) json.description = description;
  return json;
}

function emitObjectSchema(schema: z.ZodObject<z.ZodRawShape>): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(schema.shape)) {
    const { inner, optional, description } = unwrapZod(value as z.ZodTypeAny);
    const json = emitJsonSchema(inner);
    if (description && json.description == null) json.description = description;
    properties[key] = json;
    if (!optional) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function toolDef(
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: emitObjectSchema(schema) as Anthropic.Tool["input_schema"],
  };
}

/** Anthropic tool definitions for the question / general-agent tool loop. */
export const KIP_AGENT_TOOLS: Anthropic.Tool[] = [
  toolDef(
    "schedule_post",
    "Set scheduled_at for an existing draft (pending_approval / approved / scheduled). Never publishes. Does not change status to published.",
    schedulePostInputSchema,
  ),
  toolDef(
    "pull_analytics",
    "Read-only performance analysis of recent published posts (last 30). Returns insight, recommendation, winners. Never spends ads.",
    pullAnalyticsInputSchema,
  ),
  toolDef(
    "draft_copy",
    "Call this whenever the owner asked to draft, make, create, or write content (a post, carousel, first batch, trend reply, competitor reply, library pull, UGC, reel). Attached photo ids are a brief — draft immediately (carousel if several photos feel like one story). When the retrieved pack shows library photos, prefer job from_library or pass media_ids instead of generating, unless they asked for generated/stock or the brief needs a scene they did not shoot. Generated stills default to shot-on-iPhone; if this piece should look more professional, say so in brief. Set overlay none or headline (and overlay_tone quiet or shouty) to THIS brand's overlay language from facts, voice, visual.fonts, and on-image design rules — then repeat it. Set elements none or mark or constructed to THIS brand's construction language from research, remembered likes, and visual tokens — then repeat it; constructed puts type and the mark on a generated photo unless they asked for graphics-only cards; never a niche table, never a new roll each post. Never scout_ideas for a draft ask. Never publishes — owner still approves.",
    draftCopyInputSchema,
  ),
  toolDef(
    "get_offered_draft",
    "Read the pending draft currently in front of the owner (caption vs on-image text, media, format). Use before mutating a draft.",
    getOfferedDraftInputSchema,
  ),
  toolDef(
    "revise_caption",
    "Rewrite ONLY the feed caption on the offered draft. Not for removing text burned onto the image — use set_image_text for that. Never publishes.",
    reviseCaptionInputSchema,
  ),
  toolDef(
    "set_image_text",
    "Turn on/off text burned onto the IMAGE of the offered draft. enabled=false restores the clean source photo and clears the overlay; caption is unchanged. Never publishes.",
    setImageTextInputSchema,
  ),
  toolDef(
    "restyle_image",
    "Re-edit the offered draft PHOTO from source (brighter, background, vibe). Re-applies overlay only if the draft already had wants_text. Never publishes.",
    restyleImageInputSchema,
  ),
  toolDef(
    "regenerate_creative",
    "Scrap the offered draft and queue a fresh creative (draft_posts kickoff). Never publishes.",
    regenerateCreativeInputSchema,
  ),
  toolDef(
    "reject_draft",
    "Discard the offered pending draft without publishing. Use when the owner wants it scrapped.",
    rejectDraftInputSchema,
  ),
  toolDef(
    "check_calendar",
    "Read-only SMS rundown of upcoming committed posts over the next N days (pending_approval / approved / scheduled with a scheduled_at). Does not schedule or publish.",
    checkCalendarInputSchema,
  ),
  toolDef(
    "escalate_to_human",
    "Flag a situation Kip cannot handle (blocked, policy, spend, complaint, unclear, out of scope). Stay in character in SMS — do not mention an operator or human backup.",
    escalateInputSchema,
  ),
  toolDef(
    "remember_fact",
    "Store a short owner preference or decision on the brand for later turns. Keep text brief. Includes lasting visual likes (always/never logo, live on graphics vs photos). Does not publish or change posts.",
    rememberFactInputSchema,
  ),
  toolDef(
    "scout_ideas",
    "Research-backed content ideas: reuses competitor watches + research snapshots (hooks, Ad Library angles, niche themes, visual exemplars), refreshing via deep research when thin. Use only when they asked for suggestions, ideas, or to look into topics — not to draft. If they asked to draft/make a post, call draft_copy instead (the retrieved pack already has kit + market visuals). Prefer this over interviewing them. Does not draft or publish.",
    scoutIdeasInputSchema,
  ),
  toolDef(
    "confirm_pending_ask",
    "Accept or reject the last confirm you asked when it is NOT a publish yes: content plan (pillars only — never enqueue first_batch), booking link, strategy brief, organic campaign, or perf mix. Do not use this for a yes on an offered draft. Never publishes. Never spends ads.",
    confirmPendingAskInputSchema,
  ),
];

export function isValidKickoffKind(kind: unknown): kind is KipKickoffKindT {
  return typeof kind === "string" && (KipKickoffKind as readonly string[]).includes(kind);
}

export function captionExcerpt(caption: string | null | undefined, max = 120): string {
  const t = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(no caption)";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildBrandProfilePayload(brand: Brand): Record<string, unknown> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const mech = profile.writing_mechanics;
  const toneNotes = [
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}` : null,
    profile.emoji_policy ? `Emoji: ${profile.emoji_policy}` : null,
    mech?.exclamation_usage ? `Exclamations: ${mech.exclamation_usage}` : null,
    profile.notes.length ? `Notes: ${profile.notes.slice(0, 5).join("; ")}` : null,
  ].filter(Boolean);

  return {
    name: brand.name,
    connection: connectionSummary(brand),
    facts: factsForPrompt(brand.facts),
    brandContext: brandContextForPrompt(brand) || "(no strategy context on file yet)",
    voiceToneNotes: toneNotes.length ? toneNotes.join("; ") : "(no voice tone notes yet)",
    kip_preferences: brand.facts?.kip_preferences?.slice(-8) ?? [],
    kip_decisions: brand.facts?.kip_decisions?.slice(-8) ?? [],
  };
}

type CalendarRow = { id: string; status: PostStatus; scheduled_at: string; caption: string | null };

function calendarStatusLabel(status: PostStatus): string {
  if (status === "pending_approval") return "awaiting approval";
  return status.replace(/_/g, " ");
}

/**
 * Conservative: owner is only asking what is already on the calendar.
 * Kickoff / draft / ads compound asks fall through to the agent.
 */
export function looksLikeCalendarAsk(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  const t = body.trim();
  if (looksLikeKickoffRequest(t)) return false;
  if (/\b(promote|boost)\b/i.test(t)) return false;
  if (/\b(and|also)\b/i.test(t) && /\b(draft|carousel|reel|make me|write me|first batch)\b/i.test(t)) {
    return false;
  }
  return (
    /\b(what(?:'?s|s| is)|anything)\b[\s\S]{0,48}\b(on (?:my |the )?(?:calendar|schedule)|coming up|scheduled)\b/i.test(
      t,
    ) ||
    /\b(?:check|show|see) (?:me )?(?:my |the )?(?:calendar|schedule)\b/i.test(t) ||
    /\bthis week'?s (?:posts?|calendar|schedule)\b/i.test(t) ||
    /\b(?:my |the )?(?:content )?calendar\b/i.test(t) ||
    /\bscheduled (?:this|for the) (?:week|weekend)\b/i.test(t)
  );
}

/**
 * Owner wants content ideas / suggestions — not a draft yet.
 * Fast-path to scout_ideas so Kip never interviews for niche first.
 */
export function looksLikeIdeasAsk(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  const t = body.trim();
  if (looksLikeKickoffRequest(t)) return false;
  if (looksLikeCalendarAsk(t)) return false;
  // Draft/make a specific asset → not an ideas ask.
  if (
    /\b(draft|write|make|create|generate|schedule)\b/i.test(t) &&
    /\b(post|carousel|reel|story|caption|batch)\b/i.test(t) &&
    !/\bideas?\b/i.test(t)
  ) {
    return false;
  }
  return (
    /\b(give me|send me|need|want|got any|come up with|suggest|brainstorm|hit me with)\b[\s\S]{0,48}\b(ideas?|suggestions?)\b/i.test(
      t,
    ) ||
    /\b\d+\s+(post\s+)?ideas?\b/i.test(t) ||
    /\b(post|content)\s+ideas?\b/i.test(t) ||
    /\bwhat should i post\b/i.test(t) ||
    /\bideas? for (this|the) week\b/i.test(t) ||
    /\blook into\b[\s\S]{0,48}\b(ideas?|topics?|angles?)\b/i.test(t)
  );
}

/** Owner asking what Kip already knows about the brand — answer from memory, no intake quiz. */
export function looksLikeBrandRecallAsk(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  const t = body.trim();
  if (looksLikeKickoffRequest(t) || looksLikeIdeasAsk(t)) return false;
  return (
    /\bwhat do you (know|remember) about (my |the )?brand\b/i.test(t) ||
    /\bwhat(?:'?s| have you) (got|on file|stored) (on|about|for) (me|my brand|us)\b/i.test(t) ||
    /\btell me what you know\b/i.test(t) ||
    /\bwhat(?:'?s| is) on file (about|for) (me|my brand)\b/i.test(t) ||
    /\bremind me what you(?:'?ve| have) (got|saved|stored)\b/i.test(t)
  );
}

function countFromIdeasAsk(body: string): number {
  const m = body.match(/\b([1-6])\s+(?:post\s+)?ideas?\b/i);
  if (m) return Number(m[1]);
  return 3;
}

/** Scout + SMS rundown for the ideas fast path. */
export async function loadIdeasSms(brand: Brand, ownerMessage: string): Promise<string> {
  const count = countFromIdeasAsk(ownerMessage);
  const result = await scoutContentIdeas(brand, {
    focus: ownerMessage.slice(0, 400),
    count,
  });
  if (!result.ok) {
    return humanizeChat(
      "Hit a snag pulling research — say go and I'll retry with fresh angles.",
    );
  }
  return humanizeChat(formatIdeasSms(result.ideas, result.note));
}

/** Memory rundown for brand-recall fast path — no niche intake questions. */
export function summarizeBrandRecall(brand: Brand): string {
  const lab = brand.facts?.lab === true;
  const niche =
    typeof brand.facts?.differentiators === "string" ? brand.facts.differentiators.trim() : "";
  const prefs = readKipPreferences(brand.facts).map((p) => p.text).filter(Boolean);
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const bits: string[] = ["Here's what I've got on file:"];

  if (niche) {
    bits.push(`Niche: ${niche}.`);
  } else if (lab) {
    bits.push("Niche: not locked yet.");
  } else if (brand.name?.trim()) {
    bits.push(`Brand: ${brand.name.trim()}.`);
  }

  const prefBits: string[] = [];
  if (profile.tone.length) prefBits.push(`${profile.tone.join("/")} tone`);
  for (const p of prefs.slice(0, 5)) prefBits.push(p);
  if (profile.donts.length) {
    prefBits.push(`don't: ${profile.donts.slice(0, 3).join(", ")}`);
  }
  if (prefBits.length) {
    bits.push(`Preferences: ${prefBits.join("; ")}.`);
  } else {
    bits.push("Preferences: none stored yet.");
  }

  const ctx = brandContextForPrompt(brand).trim();
  if (ctx) bits.push("Strategy notes are on file.");

  bits.push("That's the solid stuff I'm holding.");
  return bits.join(" ");
}

export async function loadBrandRecallSms(brand: Brand): Promise<string> {
  return humanizeChat(summarizeBrandRecall(brand));
}

/** Summarize committed upcoming posts as SMS prose (read-only). */
export function summarizeCalendar(
  rows: CalendarRow[],
  days: number,
  now = new Date(),
): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const byDay = new Map<string, CalendarRow[]>();
  const dayDates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dayDates.push(d);
    byDay.set(localYmd(d), []);
  }

  const posts = rows
    .filter((r) => {
      const t = new Date(r.scheduled_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  for (const p of posts) {
    const key = localYmd(new Date(p.scheduled_at));
    const list = byDay.get(key);
    if (list) list.push(p);
  }

  const horizon = days <= 7 ? "this week" : `the next ${days} days`;
  if (posts.length === 0) {
    return `Nothing on the calendar ${horizon} yet.`;
  }

  const shown = posts.slice(0, 4);
  const extra = posts.length - shown.length;
  const bits = shown.map((p) => {
    const when = formatScheduledSlot(new Date(p.scheduled_at));
    const cap = captionExcerpt(p.caption, 42);
    return `${when}, ${cap} (${calendarStatusLabel(p.status)})`;
  });
  let out = days <= 7 ? `This week: ${bits.join(". ")}.` : `Coming up: ${bits.join(". ")}.`;
  if (extra > 0) {
    out += ` Plus ${extra} more.`;
  }

  const emptyWeekdays = dayDates
    .filter((d) => (byDay.get(localYmd(d)) ?? []).length === 0)
    .map((d) => formatWeekday(d));
  if (emptyWeekdays.length === 0) {
    return out;
  }
  if (emptyWeekdays.length <= 3) {
    const verb = emptyWeekdays.length === 1 ? "is" : "are";
    out += ` ${joinEnglish(emptyWeekdays)} ${verb} open.`;
  } else {
    out += " Some days are still open.";
  }
  return out;
}

/** SQL + SMS rundown for the calendar fast path and check_calendar tool. */
export async function loadCalendarSms(
  brand: Brand,
  days = 7,
  now = new Date(),
): Promise<string> {
  const windowDays = Math.min(14, Math.max(7, Math.floor(days)));
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + windowDays);
  const start = new Date(now);
  const rows = await query<CalendarRow>(
    `select id, status, scheduled_at, caption
       from posts
      where brand_id = $1
        and status = any($2::text[])
        and scheduled_at is not null
        and scheduled_at >= $3
        and scheduled_at < $4
      order by scheduled_at asc`,
    [brand.id, CALENDAR_STATUSES, start.toISOString(), end.toISOString()],
  );
  return humanizeChat(summarizeCalendar(rows, windowDays, now));
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function toolError(error: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, error, ...extra });
}

function parseToolInput<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Invalid input" };
  }
  return { ok: true, data: parsed.data };
}

function isDraftCopyJob(value: unknown): value is DraftCopyJob {
  return typeof value === "string" && (DRAFT_COPY_JOBS as readonly string[]).includes(value);
}

function asPlatform(value: unknown): PlatformT | null {
  return typeof value === "string" && (Platform as readonly string[]).includes(value)
    ? (value as PlatformT)
    : null;
}

function asPostFormat(value: unknown): PostFormatT | null {
  return typeof value === "string" && (PostFormat as readonly string[]).includes(value)
    ? (value as PostFormatT)
    : null;
}

function futureIsoDate(value: string | undefined): Date | null {
  if (!value || value === "next_slot") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null;
  return d;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/** Count for draft_copy: explicit tool arg wins; otherwise infer from the owner's wording. */
function draftCopyCount(
  ctx: AgentToolContext,
  job: DraftCopyJob,
  requested: number | undefined,
  format?: PostFormatT,
): number {
  if (requested != null && Number.isFinite(requested)) return positiveInt(requested, 1);
  if (job === "first_batch") return 3;
  const t = ctx.ownerMessage ?? "";
  const wantsCarousel = job === "carousel" || format === "carousel" || textWantsCarousel(t);
  return inferDraftCount(t, wantsCarousel);
}

function mediaIdsFrom(ctx: AgentToolContext, inputIds?: string[]): string[] {
  const ids = [...(inputIds ?? []), ...(ctx.mediaIds ?? [])].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return [...new Set(ids)];
}

type SchedulablePost = {
  id: string;
  status: PostStatus;
  caption: string | null;
  scheduled_at: string | null;
  format: string | null;
  platform: string | null;
  pillar_id: string | null;
};

async function loadSchedulablePost(brandId: string, postId?: string): Promise<SchedulablePost | null> {
  if (postId) {
    return queryOne<SchedulablePost>(
      `select id, status, caption, scheduled_at, format, platform, pillar_id
         from posts
        where brand_id = $1 and id = $2`,
      [brandId, postId],
    );
  }
  return queryOne<SchedulablePost>(
    `select id, status, caption, scheduled_at, format, platform, pillar_id
       from posts
      where brand_id = $1
        and status = any($2::text[])
      order by coalesce(last_offered_at, scheduled_at, created_at) desc
      limit 1`,
    [brandId, SCHEDULABLE_STATUSES],
  );
}

async function toolSchedulePost(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(schedulePostInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);

  const post = await loadSchedulablePost(ctx.brand.id, parsed.data.post_id);
  if (!post) {
    return toolError(parsed.data.post_id ? "Post not found for this brand." : "No schedulable post found.");
  }
  if (!SCHEDULABLE_STATUSES.includes(post.status)) {
    return toolError(`Cannot schedule a post with status ${post.status}.`);
  }

  const platform: PlatformT =
    parsed.data.platform ?? asPlatform(post.platform) ?? "instagram";
  const format = asPostFormat(post.format);

  const when = futureIsoDate(parsed.data.when);
  const slot =
    when ??
    (await scheduleSlot({
      brandId: ctx.brand.id,
      platform,
      pillarId: post.pillar_id,
      postsPerWeek: 0,
      format,
    }));

  const sets = ["scheduled_at = $1"];
  const params: unknown[] = [slot.toISOString()];
  if (parsed.data.platform && parsed.data.platform !== post.platform) {
    sets.push(`platform = $${params.length + 1}`);
    params.push(parsed.data.platform);
  }
  params.push(post.id, ctx.brand.id, SCHEDULABLE_STATUSES);

  await query(
    `update posts
        set ${sets.join(", ")}
      where id = $${params.length - 2}
        and brand_id = $${params.length - 1}
        and status = any($${params.length}::text[])`,
    params,
  );

  const needsApproval = post.status === "pending_approval";
  return JSON.stringify({
    ok: true,
    postId: post.id,
    scheduledAt: slot.toISOString(),
    status: post.status,
    note: needsApproval
      ? "Scheduled time updated only — not published. Still needs owner approval."
      : "Scheduled time updated only — not published.",
  });
}

async function toolPullAnalytics(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(pullAnalyticsInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  try {
    const analysis = await buildPerformanceAnalysis(ctx.brand);
    return JSON.stringify({
      ok: true,
      insight: analysis.insight,
      recommendation: analysis.recommendation,
      winners: analysis.winners,
      enoughData: analysis.enoughData,
      text: analysis.text,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

async function toolCheckCalendar(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(checkCalendarInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const raw = parsed.data.days;
  const days =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(14, Math.max(7, Math.floor(raw)))
      : 10;
  return loadCalendarSms(ctx.brand, days);
}

async function toolRememberFact(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(rememberFactInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const text = clampMemoryText(parsed.data.text);
  if (!text) {
    return toolError("text is required and must be non-empty");
  }
  const bucket: KipMemoryBucket =
    parsed.data.bucket === "kip_decisions" ? "kip_decisions" : "kip_preferences";
  const merged = await recordKipMemory(ctx.brand, text, bucket);
  return JSON.stringify({
    ok: true,
    bucket,
    text,
    stored: (merged[bucket] ?? []).length,
  });
}

async function toolEscalateToHuman(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(escalateInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const { reason, summary } = parsed.data;
  console.log(
    JSON.stringify({
      event: "kip_escalate",
      brandId: ctx.brand.id,
      reason,
      summary: summary.slice(0, 200),
    }),
  );
  const alert = `Kip escalate: ${ctx.brand.name} [${reason}] ${summary.slice(0, 200)}`;
  if (ctx.operatorAlerts) ctx.operatorAlerts.push(alert);
  if (ctx.notifyOperator) {
    try {
      await ctx.notifyOperator(alert);
    } catch {
      /* swallow */
    }
  }
  return JSON.stringify({
    ok: true,
    reason,
    summary,
    ownerAckHint: "I'll look into this and come back to you.",
    note: "Do not mention an operator, agency, or human backup in SMS. Stay in character as Kip.",
  });
}

async function queueDraftKickoff(
  ctx: AgentToolContext,
  job: DraftCopyJob,
  kind: KipKickoffKindT,
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await enqueueKickoff(ctx.brand, kind, {
    payload,
    reason: "user_request",
    sourceMessageId: ctx.sourceMessageId ?? null,
  });
  return JSON.stringify({
    ok: true,
    job,
    kickoffId: result.kickoff?.id ?? null,
    alreadyQueued: result.alreadyQueued,
    ackSms: result.ackSms,
    note: KICKOFF_NOTE,
  });
}

function topicHintOf(brief?: string, topicHint?: string): string | undefined {
  const t = (topicHint || brief || "").trim();
  return t || undefined;
}

/** Preserve owner-named platforms even when the model shortens the brief. */
function destinationsForDraft(
  ctx: AgentToolContext,
  hint?: string,
): string[] {
  return extractPlatforms([ctx.ownerMessage, hint].filter(Boolean).join("\n"));
}

function enrichTopicHint(hint: string | undefined, destinations: string[]): string | undefined {
  let t = (hint ?? "").trim();
  if (!t && !destinations.length) return undefined;
  if (isLinkedInPrimary(destinations) && t && !/\blinkedin\b/i.test(t)) {
    t = `LinkedIn: ${t}`;
  } else if (isLinkedInPrimary(destinations) && !t) {
    t = "LinkedIn post";
  }
  return t || undefined;
}

async function firstPillar(brandId: string) {
  const pillars = await ensurePillars(brandId);
  return pillars[0] ?? null;
}

async function draftFromAttachedMedia(
  ctx: AgentToolContext,
  job: DraftCopyJob,
  ids: string[],
  topicHint?: string,
  format?: PostFormatT,
): Promise<string | null> {
  if (ids.length === 0) return null;
  const pillar = await firstPillar(ctx.brand.id);
  if (!pillar) return toolError("No content pillars available.");

  const wantsCarousel =
    job === "carousel" || format === "carousel" || (ids.length >= 2 && !/separat|split|each/i.test(ctx.ownerMessage ?? ""));

  if (ids.length >= 2 && wantsCarousel) {
    const drafted = await draftCarouselFromPhotos(ctx.brand, ids, pillar, {
      brief: topicHint,
    });
    if (!drafted?.post) return toolError("Could not draft carousel from those photos.");
    rememberMediaUrl(ctx, drafted.mediaUrl);
    return JSON.stringify({
      ok: true,
      job,
      postId: drafted.post.id,
      captionExcerpt: captionExcerpt(drafted.post.caption),
      slides: drafted.post.media_ids.length,
      ackSms: "Drafted a carousel from those photos — still needs your approval. Nothing is published.",
      note: "Draft only — never published. Owner still approves. Do not ask them to type carousel or separate.",
    });
  }

  const photo =
    (await queryOne<MediaAsset>(
      `select * from media_assets where id = $1 and brand_id = $2`,
      [ids[0], ctx.brand.id],
    )) ?? ({ id: ids[0] } as MediaAsset);
  const drafted = await draftPostFromPhoto(
    ctx.brand,
    photo,
    pillar,
    topicHint?.trim() ? { hint: topicHint.trim() } : undefined,
  );
  if (!drafted?.post) return toolError("Could not draft a post from the attached photo.");
  rememberMediaUrl(ctx, drafted.mediaUrl);
  return JSON.stringify({
    ok: true,
    job,
    postId: drafted.post.id,
    captionExcerpt: captionExcerpt(drafted.post.caption),
    ackSms: "Drafted a post from that photo — still needs your approval. Nothing is published.",
    note: "Draft only — never published. Owner still approves. Talk about looks like a person; never Reply 1, 2, or 3.",
  });
}

async function toolDraftCopy(ctx: AgentToolContext, input: unknown): Promise<string> {
  const rec = asRecord(input);
  if (!isDraftCopyJob(rec.job)) {
    return toolError(rec.job == null ? "job is required" : `Unknown job: ${String(rec.job)}`, {
      allowedJobs: [...DRAFT_COPY_JOBS],
    });
  }
  const parsed = parseToolInput(draftCopyInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error, { allowedJobs: [...DRAFT_COPY_JOBS] });

  const { job, brief, format, visuals, topic_hint, overlay, overlay_tone, overlay_headline, elements } =
    parsed.data;
  const count = draftCopyCount(ctx, job, parsed.data.count, format);
  const ids = mediaIdsFrom(ctx, parsed.data.media_ids);
  const hint = topicHintOf(brief, topic_hint);
  const destinations = destinationsForDraft(ctx, hint);
  const topicHint = enrichTopicHint(hint, destinations);
  const overlayPayload = {
    ...(overlay ? { overlay } : {}),
    ...(overlay_tone ? { overlay_tone } : {}),
    ...(overlay_headline?.trim() ? { overlay_headline: overlay_headline.trim() } : {}),
  };
  const elementsPayload = elements ? { elements } : {};

  switch (job) {
    case "caption": {
      const drafted = await draftCaption(ctx.brand.id, ids, {
        hint: [ctx.retrievedPack, brief].filter(Boolean).join("\n"),
        asLinkedIn: isLinkedInPrimary(destinations),
      });
      const caption = drafted.caption ?? "";
      let postId: string | null = null;
      try {
        const slot = await scheduleSlot({
          brandId: ctx.brand.id,
          platform: isLinkedInPrimary(destinations) ? "linkedin" : "instagram",
          pillarId: null,
          postsPerWeek: 0,
          format: format ?? "feed",
        });
        const row = await queryOne<{ id: string }>(
          `insert into posts (brand_id, caption, media_ids, platform, status, scheduled_at, format)
           values ($1, $2, $3::uuid[], $6, 'pending_approval', $4, $5)
           returning id`,
          [
            ctx.brand.id,
            caption,
            ids,
            slot.toISOString(),
            format ?? "feed",
            isLinkedInPrimary(destinations) ? "linkedin" : "instagram",
          ],
        );
        postId = row?.id ?? null;
      } catch {
        postId = null;
      }
      if (!caption && !postId) {
        return toolError("Could not draft a caption.");
      }
      return JSON.stringify({
        ok: true,
        job,
        postId,
        captionExcerpt: captionExcerpt(caption),
        ackSms: "Drafted a caption — still needs your approval. Nothing is published.",
        note: "Draft only — never published. Owner still approves.",
      });
    }
    case "post": {
      const attached = await draftFromAttachedMedia(ctx, job, ids, topicHint, format);
      if (attached) return attached;
      return queueDraftKickoff(ctx, job, "draft_posts", {
        count,
        topicHint,
        format,
        visuals,
        preferCarousel: format === "carousel",
        ...(destinations.length ? { destinations } : {}),
        ...overlayPayload,
        ...elementsPayload,
      });
    }
    case "first_batch":
      return queueDraftKickoff(ctx, job, "first_batch", {
        count,
        visuals,
        topicHint,
        ...(destinations.length ? { destinations } : {}),
        ...overlayPayload,
        ...elementsPayload,
      });
    case "carousel": {
      const attached = await draftFromAttachedMedia(ctx, job, ids, topicHint, "carousel");
      if (attached) return attached;
      return queueDraftKickoff(ctx, job, "draft_posts", {
        count,
        topicHint,
        format: "carousel",
        visuals,
        preferCarousel: true,
        ...(destinations.length ? { destinations } : {}),
        ...overlayPayload,
        ...elementsPayload,
      });
    }
    case "story": {
      let photoId = ids[0];
      if (!photoId) {
        const fresh = await pickFreshPhoto(ctx.brand.id);
        photoId = fresh?.id;
      }
      if (!photoId) {
        return queueDraftKickoff(ctx, job, "draft_posts", {
          count,
          topicHint,
          format: "story",
          visuals,
          ...(destinations.length ? { destinations } : {}),
          ...overlayPayload,
          ...elementsPayload,
        });
      }
      const pillar = await firstPillar(ctx.brand.id);
      if (!pillar) return toolError("No content pillars available.");
      const drafted = await draftStoryFromPhoto(ctx.brand, { id: photoId }, pillar, topicHint);
      if (!drafted?.post) return toolError("Could not draft story.");
      return JSON.stringify({
        ok: true,
        job,
        postId: drafted.post.id,
        captionExcerpt: captionExcerpt(drafted.post.caption),
        ackSms: "Drafted a story — still needs your approval unless it was a candid auto-schedule. Nothing is published by this tool.",
        note: "Draft only — this tool never sets status published.",
      });
    }
    case "trend":
      return queueDraftKickoff(ctx, job, "trend_draft", {
        topicHint,
        visuals,
        ...(destinations.length ? { destinations } : {}),
        ...overlayPayload,
        ...elementsPayload,
      });
    case "competitor":
      return queueDraftKickoff(ctx, job, "competitor_draft", {
        topicHint,
        visuals,
        ...(destinations.length ? { destinations } : {}),
        ...overlayPayload,
        ...elementsPayload,
      });
    case "from_library": {
      const photo = await pickFreshPhoto(ctx.brand.id);
      if (!photo) return toolError("No unused library photos.");
      const pillar = await firstPillar(ctx.brand.id);
      if (!pillar) return toolError("No content pillars available.");
      const drafted = await draftPostFromPhoto(
        ctx.brand,
        photo,
        pillar,
        brief?.trim() ? { hint: brief.trim() } : undefined,
      );
      if (!drafted?.post) return toolError("Could not draft from library photo.");
      return JSON.stringify({
        ok: true,
        job,
        postId: drafted.post.id,
        captionExcerpt: captionExcerpt(drafted.post.caption),
        ackSms: "Pulled one of your library photos into a draft — still needs your approval. Nothing is published.",
        note: "Draft only — never published. Owner still approves.",
      });
    }
    case "ugc": {
      const result = await queueUgcJob(ctx.brand, hint || "UGC", ids);
      if (!result.ok) {
        return JSON.stringify({ ok: false, error: result.sms, ackSms: result.sms });
      }
      return JSON.stringify({
        ok: true,
        job,
        ackSms: result.sms,
        note: KICKOFF_NOTE,
      });
    }
    case "reel": {
      const result = await queueAiVideoJob(ctx.brand, hint || "", ids);
      if (!result.ok) {
        return JSON.stringify({ ok: false, error: result.sms, ackSms: result.sms });
      }
      return JSON.stringify({
        ok: true,
        job,
        ackSms: result.sms,
        note: KICKOFF_NOTE,
      });
    }
  }
}

function rememberMediaUrl(ctx: AgentToolContext, mediaUrl?: string | null) {
  if (ctx.lastMediaUrl && mediaUrl) ctx.lastMediaUrl.url = mediaUrl;
}

async function resolveOfferedPost(ctx: AgentToolContext, postId?: string) {
  if (postId?.trim()) {
    const row = await queryOne<Post>(
      `select * from posts where id = $1 and brand_id = $2 and status = 'pending_approval'`,
      [postId.trim(), ctx.brand.id],
    );
    if (!row) return null;
    return row;
  }
  return loadOfferedDraft(ctx.brand.id);
}

async function toolGetOfferedDraft(ctx: AgentToolContext): Promise<string> {
  const post = await loadOfferedDraft(ctx.brand.id);
  if (!post) {
    return JSON.stringify({
      ok: true,
      pending: false,
      note: "No pending_approval draft in front of the owner right now.",
    });
  }
  return JSON.stringify({
    ok: true,
    pending: true,
    draft: formatOfferedDraftBlock(post),
    postId: post.id,
  });
}

async function toolReviseCaption(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(reviseCaptionInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const post = await resolveOfferedPost(ctx, parsed.data.post_id);
  if (!post) return toolError("No pending draft to revise.");
  const result = await reviseOfferedDraftCaption(ctx.brand, post, parsed.data.instruction);
  rememberMediaUrl(ctx, result.mediaUrl);
  return JSON.stringify(result);
}

async function toolSetImageText(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(setImageTextInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const post = await resolveOfferedPost(ctx, parsed.data.post_id);
  if (!post) return toolError("No pending draft to update.");
  const result = parsed.data.enabled
    ? await setImageOverlay(ctx.brand, post, parsed.data.headline)
    : await clearImageOverlay(ctx.brand, post);
  rememberMediaUrl(ctx, result.mediaUrl);
  return JSON.stringify(result);
}

async function toolRestyleImage(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(restyleImageInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const post = await resolveOfferedPost(ctx, parsed.data.post_id);
  if (!post) return toolError("No pending draft to restyle.");
  const result = await restyleOfferedImage(ctx.brand, post, parsed.data.instruction);
  rememberMediaUrl(ctx, result.mediaUrl);
  return JSON.stringify(result);
}

async function toolRegenerateCreative(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(regenerateCreativeInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const post = await resolveOfferedPost(ctx, parsed.data.post_id);
  if (post) {
    await rejectOfferedDraft(ctx.brand, post, "Owner asked to regenerate — rejecting prior draft");
  }
  const brief = (parsed.data.brief || "").trim();
  const result = await enqueueKickoff(ctx.brand, "draft_posts", {
    payload: {
      count: 1,
      topicHint: brief.slice(0, 400) || undefined,
      forceFresh: true,
    },
    reason: "user_request",
    sourceMessageId: ctx.sourceMessageId ?? null,
  });
  return JSON.stringify({
    ok: true,
    kickoffId: result.kickoff?.id ?? null,
    alreadyQueued: result.alreadyQueued,
    ackSms: result.ackSms ?? "On it — generating a fresh draft. I'll text when it's ready.",
    note: KICKOFF_NOTE,
  });
}

async function toolRejectDraft(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(rejectDraftInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  const post = await resolveOfferedPost(ctx, parsed.data.post_id);
  if (!post) return toolError("No pending draft to reject.");
  const result = await rejectOfferedDraft(ctx.brand, post, parsed.data.note);
  return JSON.stringify(result);
}

async function toolScoutIdeas(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(scoutIdeasInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);
  if (looksLikeKickoffRequest(ctx.ownerMessage)) {
    return toolError("Owner asked to draft content. Call draft_copy instead of scout_ideas.");
  }
  const result = await scoutContentIdeas(ctx.brand, {
    focus: parsed.data.focus,
    count: parsed.data.count,
    retrievedPack: ctx.retrievedPack,
  });
  if (!result.ok) return toolError(result.error);
  return JSON.stringify({
    ok: true,
    ideas: result.ideas,
    note: result.note,
    researchRefreshed: result.researchRefreshed,
    smsDraft: formatIdeasSms(result.ideas, result.note),
    ackHint:
      "Text the owner the smsDraft rundown (or the same titles + angles). Offer to draft one they pick. Do not interview them for more intake first.",
  });
}

async function toolConfirmPendingAsk(ctx: AgentToolContext, input: unknown): Promise<string> {
  const parsed = parseToolInput(confirmPendingAskInputSchema, input);
  if (!parsed.ok) return toolError(parsed.error);

  const offered = await loadOfferedDraft(ctx.brand.id);
  if (offered && looksLikeApproval(ctx.ownerMessage)) {
    return toolError(
      "A draft is offered and the owner said yes — that is a hard publish gate. Do not use this tool.",
    );
  }

  const kind = parsed.data.kind ?? "auto";
  const accept = parsed.data.action === "accept";

  const tryPlan = kind === "auto" || kind === "plan";
  const tryLink = kind === "auto" || kind === "booking_link";
  const tryStrategy = kind === "auto" || kind === "strategy";
  const tryCampaign = kind === "auto" || kind === "campaign";
  const tryPerf = kind === "auto" || kind === "perf";

  if (tryPlan) {
    const plan = await getProposedPlan(ctx.brand.id);
    if (plan) {
      if (accept) {
        await applyNichePlan(ctx.brand, plan);
        return JSON.stringify({
          ok: true,
          kind: "plan",
          applied: true,
          firstBatchEnqueued: false,
          ackSms: "Plan's live — pillars and cadence are set. Want me to draft the first few? Each still waits for a yes.",
          note: "Plan applied only. Never enqueues first_batch. Never publishes.",
        });
      }
      await query(`update content_plans set status = 'failed', updated_at = now() where id = $1`, [plan.id]);
      return JSON.stringify({
        ok: true,
        kind: "plan",
        applied: false,
        ackSms: "Scrapped that plan. Nothing was applied.",
      });
    }
    if (kind === "plan") return toolError("No proposed content plan waiting.");
  }

  if (tryLink && getPendingDestinationLink(ctx.brand)) {
    if (accept) {
      const confirmed = await handleDestinationLinkConfirmation(ctx.brand, "yes");
      if (!confirmed) return toolError("Could not save the booking link.");
      return JSON.stringify({
        ok: true,
        kind: "booking_link",
        ackSms: confirmed.reply,
        note: "Saved the URL only. Did not publish a post.",
      });
    }
    await clearPendingDestinationLink(ctx.brand);
    return JSON.stringify({
      ok: true,
      kind: "booking_link",
      ackSms: "Okay, skipped that booking link.",
    });
  }
  if (kind === "booking_link") return toolError("No booking link waiting to confirm.");

  if (tryStrategy) {
    const brief = await getProposedStrategyBrief(ctx.brand.id);
    if (brief) {
      if (accept) {
        const pieces = parseStrategyAccept(ctx.ownerMessage ?? "yes") ?? "all";
        const sms = await acceptStrategyPieces(ctx.brand, brief, pieces);
        return JSON.stringify({
          ok: true,
          kind: "strategy",
          ackSms: sms,
          note: "Strategy saved. Did not publish.",
        });
      }
      await cancelStrategyBrief(brief.id);
      return JSON.stringify({
        ok: true,
        kind: "strategy",
        ackSms: "Scrapped that strategy brief. Nothing was saved to your brand objects.",
      });
    }
    if (kind === "strategy") return toolError("No proposed strategy brief waiting.");
  }

  if (tryCampaign) {
    const campaign = await getProposedCampaign(ctx.brand.id);
    if (campaign) {
      if (accept) {
        const sms = await activateCampaign(ctx.brand, campaign, false);
        return JSON.stringify({
          ok: true,
          kind: "campaign",
          ackSms: sms,
          note: "Organic campaign only — no ad spend. Posts still follow approval rules.",
        });
      }
      await query(`update campaigns set status = 'cancelled' where id = $1`, [campaign.id]);
      return JSON.stringify({
        ok: true,
        kind: "campaign",
        ackSms: "No worries, I've scrapped that campaign. Nothing scheduled.",
      });
    }
    if (kind === "campaign") return toolError("No proposed campaign waiting.");
  }

  if (tryPerf) {
    if (accept) {
      const sms = await confirmPerfSuggestion(ctx.brand);
      if (!sms) return toolError("No performance suggestion waiting.");
      return JSON.stringify({
        ok: true,
        kind: "perf",
        ackSms: sms,
        note: "Mix/perf only. Did not publish a feed post.",
      });
    }
    await clearPerfPending(ctx.brand);
    return JSON.stringify({
      ok: true,
      kind: "perf",
      ackSms: "No worries — left your mix as is. Nothing changed.",
    });
  }

  return toolError("Nothing waiting to confirm.");
}

/**
 * Execute one agent tool. Returns a JSON string for Anthropic tool_result content.
 */
export async function executeAgentTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "schedule_post":
        return await toolSchedulePost(ctx, input);
      case "pull_analytics":
        return await toolPullAnalytics(ctx, input);
      case "draft_copy":
        return await toolDraftCopy(ctx, input);
      case "get_offered_draft":
        return await toolGetOfferedDraft(ctx);
      case "revise_caption":
        return await toolReviseCaption(ctx, input);
      case "set_image_text":
        return await toolSetImageText(ctx, input);
      case "restyle_image":
        return await toolRestyleImage(ctx, input);
      case "regenerate_creative":
        return await toolRegenerateCreative(ctx, input);
      case "reject_draft":
        return await toolRejectDraft(ctx, input);
      case "check_calendar":
        return await toolCheckCalendar(ctx, input);
      case "escalate_to_human":
        return await toolEscalateToHuman(ctx, input);
      case "remember_fact":
        return await toolRememberFact(ctx, input);
      case "scout_ideas":
        return await toolScoutIdeas(ctx, input);
      case "confirm_pending_ask":
        return await toolConfirmPendingAsk(ctx, input);
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
