/**
 * Bounded Anthropic client tools for Smart Kip Phase 2.
 * Read-mostly brand/calendar/posts + enqueue kickoffs + remember short facts.
 * Never publishes, never spends ads, never returns secrets/tokens.
 */

import {
  KipKickoffKind,
  brandVoiceProfileSchema,
  query,
  type Brand,
  type KipKickoffKind as KipKickoffKindT,
  type PostStatus,
} from "@pulse/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { brandContextForPrompt } from "./brandContext.js";
import { factsForPrompt } from "./businessProfile.js";
import { enqueueKickoff } from "./kickoffs.js";
import {
  clampMemoryText,
  recordKipMemory,
  type KipMemoryBucket,
} from "./kipMemory.js";
import { connectionSummary } from "./persona.js";

export type AgentToolContext = {
  brand: Brand;
  sourceMessageId?: string | null;
};

export type { KipMemoryBucket };
export { clampMemoryText, mergeKipMemoryFact, recordKipMemory } from "./kipMemory.js";

const RECENT_POST_STATUSES: PostStatus[] = [
  "pending_approval",
  "approved",
  "scheduled",
  "published",
];

const CALENDAR_STATUSES: PostStatus[] = ["pending_approval", "approved", "scheduled"];

/** Anthropic tool definitions for the question tool loop. */
export const KIP_AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_brand_profile",
    description:
      "Fetch this brand's connection status, business facts, strategy context, and voice tone notes. Use before guessing about the business. Returns plain text/JSON — no secrets or tokens.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_posts",
    description:
      "List recent posts for this brand (pending approval, approved, scheduled, or published). Includes status, caption excerpt, scheduled_at, published_at.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max posts to return (default 8, max 20).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_calendar",
    description:
      "Summarize upcoming committed posts over the next N days (pending_approval / approved / scheduled with a scheduled_at). Notes days with nothing scheduled. Read-only — does not schedule or publish.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Horizon in days (default 10, min 7, max 14).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "enqueue_kickoff",
    description:
      "Queue background draft work for Kip (first_batch, draft_posts, trend_draft, competitor_draft). Never publishes — drafts still need owner approval. Returns whether it queued or was already in flight.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...KipKickoffKind],
          description: "Which kickoff job to enqueue.",
        },
        payload: {
          type: "object",
          description: "Optional job payload (count, topicHint, visuals, etc.).",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "remember_fact",
    description:
      "Store a short owner preference or decision on the brand for later turns. Keep text brief. Does not publish or change posts.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Short preference or decision to remember.",
        },
        bucket: {
          type: "string",
          enum: ["kip_preferences", "kip_decisions"],
          description: "Where to store it (default kip_preferences).",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
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

type RecentPostRow = {
  id: string;
  status: PostStatus;
  caption: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  format: string | null;
  platform: string | null;
};

export function formatRecentPostsResult(rows: RecentPostRow[]): string {
  if (!rows.length) {
    return JSON.stringify({ posts: [], note: "No recent posts in those statuses." });
  }
  return JSON.stringify({
    posts: rows.map((r) => ({
      id: r.id,
      status: r.status,
      format: r.format,
      platform: r.platform,
      caption: captionExcerpt(r.caption),
      scheduled_at: r.scheduled_at,
      published_at: r.published_at,
    })),
  });
}

type CalendarRow = { id: string; status: PostStatus; scheduled_at: string; caption: string | null };

/** Summarize committed upcoming posts and note empty days (read-only). */
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
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), []);
  }

  const posts = rows
    .filter((r) => {
      const t = new Date(r.scheduled_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  for (const p of posts) {
    const key = new Date(p.scheduled_at).toISOString().slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(p);
  }

  const gaps: string[] = [];
  for (const [day, list] of byDay) {
    if (!list.length) gaps.push(day);
  }

  return JSON.stringify({
    days,
    from: start.toISOString(),
    to: end.toISOString(),
    posts: posts.map((p) => ({
      id: p.id,
      status: p.status,
      scheduled_at: p.scheduled_at,
      caption: captionExcerpt(p.caption, 80),
    })),
    emptyDays: gaps,
    note:
      posts.length === 0
        ? "Nothing committed with a scheduled_at in this window."
        : gaps.length
          ? `${gaps.length} day(s) with nothing scheduled.`
          : "Every day in the window has at least one committed post.",
  });
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

async function toolGetBrandProfile(ctx: AgentToolContext): Promise<string> {
  return JSON.stringify(buildBrandProfilePayload(ctx.brand));
}

async function toolGetRecentPosts(ctx: AgentToolContext, input: unknown): Promise<string> {
  const raw = asRecord(input).limit;
  const limit = Math.min(20, Math.max(1, typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 8));
  const rows = await query<RecentPostRow>(
    `select id, status, caption, scheduled_at, published_at, format, platform
       from posts
      where brand_id = $1
        and status = any($2::text[])
      order by coalesce(published_at, scheduled_at, updated_at) desc nulls last
      limit $3`,
    [ctx.brand.id, RECENT_POST_STATUSES, limit],
  );
  return formatRecentPostsResult(rows);
}

async function toolGetCalendar(ctx: AgentToolContext, input: unknown): Promise<string> {
  const raw = asRecord(input).days;
  const days =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(14, Math.max(7, Math.floor(raw)))
      : 10;
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const rows = await query<CalendarRow>(
    `select id, status, scheduled_at, caption
       from posts
      where brand_id = $1
        and status = any($2::text[])
        and scheduled_at is not null
        and scheduled_at >= $3
        and scheduled_at < $4
      order by scheduled_at asc`,
    [ctx.brand.id, CALENDAR_STATUSES, now.toISOString(), end.toISOString()],
  );
  return summarizeCalendar(rows, days, now);
}

async function toolEnqueueKickoff(ctx: AgentToolContext, input: unknown): Promise<string> {
  const rec = asRecord(input);
  if (!isValidKickoffKind(rec.kind)) {
    return JSON.stringify({
      ok: false,
      error: `Invalid kind. Allowed: ${KipKickoffKind.join(", ")}`,
    });
  }
  const payload =
    rec.payload && typeof rec.payload === "object" && !Array.isArray(rec.payload)
      ? (rec.payload as Record<string, unknown>)
      : {};
  const result = await enqueueKickoff(ctx.brand, rec.kind, {
    payload,
    reason: "user_request",
    sourceMessageId: ctx.sourceMessageId ?? null,
  });
  return JSON.stringify({
    ok: true,
    alreadyQueued: result.alreadyQueued,
    kickoffId: result.kickoff?.id ?? null,
    kind: rec.kind,
    ackSms: result.ackSms,
    note: "Queued for drafting only — never auto-publishes. Owner still approves.",
  });
}

async function toolRememberFact(ctx: AgentToolContext, input: unknown): Promise<string> {
  const rec = asRecord(input);
  const text = typeof rec.text === "string" ? clampMemoryText(rec.text) : "";
  if (!text) {
    return JSON.stringify({ ok: false, error: "text is required and must be non-empty" });
  }
  const bucket: KipMemoryBucket =
    rec.bucket === "kip_decisions" ? "kip_decisions" : "kip_preferences";
  const merged = await recordKipMemory(ctx.brand, text, bucket);
  return JSON.stringify({
    ok: true,
    bucket,
    text,
    stored: (merged[bucket] ?? []).length,
  });
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
      case "get_brand_profile":
        return await toolGetBrandProfile(ctx);
      case "get_recent_posts":
        return await toolGetRecentPosts(ctx, input);
      case "get_calendar":
        return await toolGetCalendar(ctx, input);
      case "enqueue_kickoff":
        return await toolEnqueueKickoff(ctx, input);
      case "remember_fact":
        return await toolRememberFact(ctx, input);
      default:
        return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
