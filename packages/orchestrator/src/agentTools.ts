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
  type Platform as PlatformT,
  type PostFormat as PostFormatT,
  type PostStatus,
} from "@pulse/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { brandContextForPrompt } from "./brandContext.js";
import { factsForPrompt } from "./businessProfile.js";
import { enqueueKickoff, looksLikeKickoffRequest } from "./kickoffs.js";
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
import { draftStoryFromPhoto } from "./formats.js";
import { ensurePillars } from "./pillars.js";
import { queueUgcJob } from "./ugc/index.js";
import { queueAiVideoJob } from "./aiVideo.js";

export type AgentToolContext = {
  brand: Brand;
  sourceMessageId?: string | null;
  mediaIds?: string[];
  retrievedPack?: string;
  notifyOperator?: (body: string) => Promise<boolean | void>;
  operatorAlerts?: string[];
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
    brief: z.string().optional().describe("Optional brief or instructions."),
    count: z.number().optional().describe("How many drafts to queue (job-dependent default)."),
    format: z.enum(PostFormat).optional().describe("Post format hint."),
    visuals: z
      .enum(["photo", "designed", "stock", "generated"])
      .optional()
      .describe("Visual mode for queued drafts."),
    media_ids: z.array(z.string()).optional().describe("Media asset ids to use."),
    topic_hint: z.string().optional().describe("Topic hint for queued drafts."),
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

/** Anthropic tool definitions for the question tool loop. */
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
    "Content-engine facade: draft a caption, queue posts/first batch/carousel/story/trend/competitor, pull from library, or queue UGC/reel. Never publishes — owner still approves.",
    draftCopyInputSchema,
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
    "Store a short owner preference or decision on the brand for later turns. Keep text brief. Does not publish or change posts.",
    rememberFactInputSchema,
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

async function firstPillar(brandId: string) {
  const pillars = await ensurePillars(brandId);
  return pillars[0] ?? null;
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

  const { job, brief, format, visuals, topic_hint } = parsed.data;
  const count = parsed.data.count;
  const ids = mediaIdsFrom(ctx, parsed.data.media_ids);
  const hint = topicHintOf(brief, topic_hint);

  switch (job) {
    case "caption": {
      const drafted = await draftCaption(ctx.brand.id, ids, {
        hint: [ctx.retrievedPack, brief].filter(Boolean).join("\n"),
      });
      const caption = drafted.caption ?? "";
      let postId: string | null = null;
      try {
        const slot = await scheduleSlot({
          brandId: ctx.brand.id,
          platform: "instagram",
          pillarId: null,
          postsPerWeek: 0,
          format: format ?? "feed",
        });
        const row = await queryOne<{ id: string }>(
          `insert into posts (brand_id, caption, media_ids, platform, status, scheduled_at, format)
           values ($1, $2, $3::uuid[], 'instagram', 'pending_approval', $4, $5)
           returning id`,
          [ctx.brand.id, caption, ids, slot.toISOString(), format ?? "feed"],
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
    case "post":
      return queueDraftKickoff(ctx, job, "draft_posts", {
        count: positiveInt(count, 1),
        topicHint: hint,
        format,
        visuals,
        preferCarousel: format === "carousel",
      });
    case "first_batch":
      return queueDraftKickoff(ctx, job, "first_batch", {
        count: positiveInt(count, 3),
        visuals,
        topicHint: hint,
      });
    case "carousel":
      return queueDraftKickoff(ctx, job, "draft_posts", {
        count: positiveInt(count, 1),
        topicHint: hint,
        format: "carousel",
        visuals,
        preferCarousel: true,
      });
    case "story": {
      let photoId = ids[0];
      if (!photoId) {
        const fresh = await pickFreshPhoto(ctx.brand.id);
        photoId = fresh?.id;
      }
      if (!photoId) {
        return queueDraftKickoff(ctx, job, "draft_posts", {
          count: positiveInt(count, 1),
          topicHint: hint,
          format: "story",
          visuals,
        });
      }
      const pillar = await firstPillar(ctx.brand.id);
      if (!pillar) return toolError("No content pillars available.");
      const drafted = await draftStoryFromPhoto(ctx.brand, { id: photoId }, pillar);
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
        topicHint: hint,
        visuals,
      });
    case "competitor":
      return queueDraftKickoff(ctx, job, "competitor_draft", {
        topicHint: hint,
        visuals,
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
      case "check_calendar":
        return await toolCheckCalendar(ctx, input);
      case "escalate_to_human":
        return await toolEscalateToHuman(ctx, input);
      case "remember_fact":
        return await toolRememberFact(ctx, input);
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
