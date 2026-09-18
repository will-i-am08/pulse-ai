import { randomUUID } from "node:crypto";
import {
  query,
  queryOne,
  kipEventSchema,
  type Brand,
  type BusinessFacts,
  type KipEvent,
} from "@pulse/shared";
import { callLLM, stripMarkdown } from "./llm.js";

/**
 * Episodic event memory — the "how'd the Emily Calder shoot go?" magic.
 *
 * Kip captures named events from the owner's world (shoots, launches, trips,
 * milestones) that a good manager would follow up on, recalls them in
 * conversation, and — once they've passed — asks how they went, exactly once.
 *
 * This is deliberately narrow: only things the owner TOLD Kip, never inferred
 * or scraped. Recall what they said; don't be creepy about it. Content tasks
 * ("post a reel Friday") are NOT events — those are the drafting pipeline's job.
 */

const MAX_EVENTS = 30;
const MAX_SUMMARY = 160;
/** Don't follow up until an event is clearly done — a few hours past its time. */
export const FOLLOWUP_GRACE_MS = 3 * 60 * 60 * 1000;
/** A passed event we never followed up on goes stale after two weeks. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_TZ = process.env.TZ || "Australia/Sydney";

// Cheap pre-filter so we don't burn an LLM call on every inbound. Looks for a
// time cue (day name, tomorrow, next week, a date) OR a life-event noun.
const EVENT_SIGNAL =
  /\b(today|tomorrow|tonight|yesterday|this (week|morning|arvo|afternoon|evening)|next (week|month|mon|tue|wed|thu|fri|sat|sun)|on (mon|tue|wed|thu|fri|sat|sun)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|shoot|shooting|photoshoot|launch|launching|opening|grand opening|event|expo|market|wedding|festival|meeting|pitch|interview|trip|travel|holiday|flight|conference|deadline|going live|big day)\b/i;

/** Does this message look like it might mention a real-world event? */
export function looksLikeEvent(body: string | null | undefined): boolean {
  return Boolean(body && EVENT_SIGNAL.test(body));
}

function clampSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
}

/** Local human date for the extraction prompt, e.g. "Thursday, 18 September 2026". */
function humanToday(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

/** Parse + validate the extractor's JSON into fresh KipEvents. Pure. */
export function parseEventsResponse(raw: string, nowISO: string): KipEvent[] {
  let parsed: { events?: unknown };
  try {
    const cleaned = stripMarkdown(raw);
    parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.events)) return [];
  const out: KipEvent[] = [];
  for (const item of parsed.events) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const summary = clampSummary(typeof rec.summary === "string" ? rec.summary : "");
    if (!summary) continue;
    const candidate = {
      id: randomUUID(),
      summary,
      entity: typeof rec.entity === "string" ? rec.entity.replace(/\s+/g, " ").trim().slice(0, 80) : "",
      kind: rec.kind,
      when_iso: typeof rec.when_iso === "string" && rec.when_iso.trim() ? rec.when_iso.trim() : null,
      when_text: typeof rec.when_text === "string" ? rec.when_text.replace(/\s+/g, " ").trim().slice(0, 80) : "",
      created_at: nowISO,
      followed_up_at: null,
      status: "upcoming" as const,
    };
    const validated = kipEventSchema.safeParse(candidate);
    if (validated.success) out.push(validated.data);
  }
  return out;
}

/** Ask the model to pull real-world events out of one owner message. */
export async function extractEventsFromMessage(
  brand: Brand,
  message: string,
  now: Date = new Date(),
): Promise<KipEvent[]> {
  const tz = DEFAULT_TZ;
  const system = [
    "You extract concrete real-world events from a business owner's text message — the things a great manager would remember and follow up on later.",
    `Today is ${humanToday(now, tz)} (timezone ${tz}).`,
    "Capture: shoots, product/store launches, openings, markets/expos, weddings, trips/travel/holidays, meetings/pitches/interviews, deadlines, personal milestones — things happening in THEIR life or business.",
    "Do NOT capture: content tasks or posting plans (\"post a reel Friday\", \"schedule the carousel\"), vague someday-maybe plans, or anything about drafts/captions/scheduling. Those are not events.",
    "For each event resolve the date to when_iso (ISO 8601) using today's date above; if no date is stated, when_iso is null. Keep the owner's own time phrase in when_text.",
    'kind is one of: shoot, launch, event, meeting, trip, deadline, personal, other.',
    'entity is the proper-noun anchor if there is one (a person, client, or place), else "".',
    'Output ONLY JSON: {"events":[{"summary":"","entity":"","kind":"","when_iso":null,"when_text":""}]}. If there are no events, output {"events":[]}.',
  ].join("\n");
  let raw: string;
  try {
    raw = await callLLM({
      system,
      messages: [{ role: "user", content: message }],
      maxTokens: 300,
      task: "event-extract",
    });
  } catch {
    return [];
  }
  return parseEventsResponse(raw, now.toISOString());
}

/** Read + validate stored events off facts. */
export function readEvents(facts: BusinessFacts | null | undefined): KipEvent[] {
  const raw = facts?.kip_events;
  if (!Array.isArray(raw)) return [];
  const out: KipEvent[] = [];
  for (const item of raw) {
    const parsed = kipEventSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function dedupeKey(e: Pick<KipEvent, "summary" | "when_iso">): string {
  return `${e.summary.toLowerCase()}|${e.when_iso ?? ""}`;
}

/** Merge fresh events into what's stored (dedupe, cap), atomically on the kip_events key. */
export async function rememberEvents(brand: Brand, fresh: KipEvent[]): Promise<KipEvent[]> {
  if (fresh.length === 0) return readEvents(brand.facts);
  // Re-read current state to reduce clobbering a concurrent capture.
  const row = await queryOne<{ facts: BusinessFacts | null }>(
    `select facts from brands where id = $1`,
    [brand.id],
  );
  const existing = readEvents(row?.facts ?? brand.facts);
  const byKey = new Map<string, KipEvent>();
  for (const e of existing) byKey.set(dedupeKey(e), e);
  for (const e of fresh) {
    const k = dedupeKey(e);
    if (!byKey.has(k)) byKey.set(k, e); // keep the earlier capture if it's a repeat
  }
  let merged = [...byKey.values()];
  if (merged.length > MAX_EVENTS) {
    // Evict closed first (oldest), then oldest overall.
    merged.sort((a, b) => {
      const ac = a.status === "closed" ? 0 : 1;
      const bc = b.status === "closed" ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.created_at.localeCompare(b.created_at);
    });
    merged = merged.slice(merged.length - MAX_EVENTS);
  }
  await writeEvents(brand.id, merged);
  return merged;
}

/** Atomic write of just the kip_events key (never clobbers sibling facts). */
async function writeEvents(brandId: string, events: KipEvent[]): Promise<void> {
  await query(
    `update brands
        set facts = jsonb_set(coalesce(facts, '{}'::jsonb), '{kip_events}', $2::jsonb, true)
      where id = $1`,
    [brandId, JSON.stringify(events)],
  );
}

/** Fire-and-forget capture for reply paths — never blocks the owner's answer. */
export function scheduleEventCapture(brand: Brand, ownerMessage: string | null | undefined): void {
  const body = (ownerMessage ?? "").trim();
  if (!body || !looksLikeEvent(body)) return;
  void (async () => {
    try {
      const fresh = await extractEventsFromMessage(brand, body);
      if (fresh.length) await rememberEvents(brand, fresh);
    } catch (err) {
      console.error(`scheduleEventCapture: brand ${brand.id}`, err);
    }
  })();
}

/** Short recall block for persona / reengage prompts. Empty when nothing to say. */
export function eventsPromptBlock(
  facts: BusinessFacts | null | undefined,
  now: Date = new Date(),
): string {
  const events = readEvents(facts);
  if (!events.length) return "";
  const nowMs = now.getTime();
  const isPast = (e: KipEvent) => e.when_iso != null && new Date(e.when_iso).getTime() < nowMs;
  const upcoming = events
    .filter((e) => e.status !== "closed" && !isPast(e))
    .slice(-3);
  const passed = events
    .filter((e) => e.status !== "closed" && isPast(e) && !e.followed_up_at)
    .slice(-2);
  if (!upcoming.length && !passed.length) return "";
  const lines = ["In the owner's world (react naturally when it fits; never dump as a list):"];
  for (const e of passed) {
    lines.push(`- Just happened${e.when_text ? ` (${e.when_text})` : ""}: ${e.summary} — ask warmly how it went.`);
  }
  for (const e of upcoming) {
    lines.push(`- Coming up${e.when_text ? ` (${e.when_text})` : ""}: ${e.summary}.`);
  }
  return lines.join("\n");
}

export interface DueEventResult {
  /** The one event to follow up on now, or null. */
  due: KipEvent | null;
  /** Passed-but-never-asked events too old to bother with — close silently. */
  toClose: KipEvent[];
}

/** Pure selection: which passed event (if any) to follow up on, and which to retire. */
export function selectDueEvent(
  events: KipEvent[],
  now: Date,
  opts: { graceMs?: number; staleMs?: number } = {},
): DueEventResult {
  const graceMs = opts.graceMs ?? FOLLOWUP_GRACE_MS;
  const staleMs = opts.staleMs ?? STALE_MS;
  const nowMs = now.getTime();
  const toClose: KipEvent[] = [];
  const candidates: KipEvent[] = [];
  for (const e of events) {
    if (e.status === "closed" || e.followed_up_at) continue;
    if (e.when_iso == null) continue; // can't tell it's passed
    const whenMs = new Date(e.when_iso).getTime();
    if (Number.isNaN(whenMs)) continue;
    const sincePassed = nowMs - whenMs;
    if (sincePassed < graceMs) continue; // not passed yet (or too fresh)
    if (sincePassed > staleMs) {
      toClose.push(e);
      continue;
    }
    candidates.push(e);
  }
  // Soonest-passed first = most recent when_iso (smallest time since passing).
  candidates.sort(
    (a, b) => new Date(b.when_iso as string).getTime() - new Date(a.when_iso as string).getTime(),
  );
  return { due: candidates[0] ?? null, toClose };
}

/** Mark an event followed-up (and passed) so it's never asked about twice. */
export async function markEventFollowedUp(
  brandId: string,
  eventId: string,
  nowISO: string,
): Promise<void> {
  const row = await queryOne<{ facts: BusinessFacts | null }>(
    `select facts from brands where id = $1`,
    [brandId],
  );
  const events = readEvents(row?.facts);
  const next = events.map((e) =>
    e.id === eventId ? { ...e, followed_up_at: nowISO, status: "passed" as const } : e,
  );
  await writeEvents(brandId, next);
}

/** Retire stale events silently (passed long ago, never worth asking now). */
export async function closeEvents(brandId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const row = await queryOne<{ facts: BusinessFacts | null }>(
    `select facts from brands where id = $1`,
    [brandId],
  );
  const events = readEvents(row?.facts);
  const next = events.map((e) => (idSet.has(e.id) ? { ...e, status: "closed" as const } : e));
  await writeEvents(brandId, next);
}
