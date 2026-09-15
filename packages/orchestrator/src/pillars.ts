import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { query, getMedia, schedulePinSchema, type Brand, type Pillar, type SchedulePin } from "@pulse/shared";
import { callLLM } from "./llm.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human words for a pillar's pin, for prompts and confirmations. */
export function describePin(pin: unknown): string {
  const parsed = schedulePinSchema.safeParse(pin ?? {});
  if (!parsed.success || parsed.data.mode === "flex") return "flexible timing";
  const p = parsed.data;
  const time = `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "am" : "pm"}`;
  if (p.mode === "weekly") {
    const days = [...p.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]!);
    return `pinned ${days.join(" & ")} ${time}`;
  }
  const dates = [...p.monthDays].sort((a, b) => a - b).join(" & ");
  return `pinned monthly on the ${dates} at ${time}`;
}

// Content pillars are the varied "portfolio" backbone: every brand gets a
// starter set (editable later), incoming photos are auto-classified into one,
// and the scheduler + autopilot operate per pillar.

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

export const DEFAULT_PILLARS: Array<Omit<Pillar, "id" | "brand_id" | "created_at" | "last_gap_ping_at" | "schedule_pin">> = [
  { key: "behind_the_scenes", name: "Behind the scenes", description: "Process, day-in-the-life, how the work gets made, the team at work.", posts_per_week: 2, autopilot: false, sort: 0 },
  { key: "product", name: "Product & offers", description: "What you sell — products, services, menu items, promotions and offers.", posts_per_week: 2, autopilot: false, sort: 1 },
  { key: "social_proof", name: "Social proof", description: "Testimonials, reviews, results, happy customers, press and wins.", posts_per_week: 1, autopilot: false, sort: 2 },
  { key: "educational", name: "Educational", description: "Tips, how-tos, advice and value that teaches the audience something.", posts_per_week: 2, autopilot: false, sort: 3 },
  { key: "lifestyle", name: "Lifestyle & culture", description: "Brand lifestyle, culture, values, community and the vibe around the brand.", posts_per_week: 1, autopilot: false, sort: 4 },
];

/** Ensure a brand has pillars; seed the defaults on first use. Returns them sorted. */
export async function ensurePillars(brandId: string): Promise<Pillar[]> {
  const existing = await query<Pillar>("select * from pillars where brand_id = $1 order by sort, created_at", [brandId]);
  if (existing.length > 0) return existing;
  for (const p of DEFAULT_PILLARS) {
    await query(
      `insert into pillars (brand_id, key, name, description, posts_per_week, autopilot, sort)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (brand_id, key) do nothing`,
      [brandId, p.key, p.name, p.description, p.posts_per_week, p.autopilot, p.sort],
    );
  }
  return query<Pillar>("select * from pillars where brand_id = $1 order by sort, created_at", [brandId]);
}

export async function listPillars(brandId: string): Promise<Pillar[]> {
  return query<Pillar>("select * from pillars where brand_id = $1 order by sort, created_at", [brandId]);
}

/** Vision classify a photo into one of the brand's pillars. Falls back to the first pillar. */
export async function classifyPhotoPillar(
  brand: Brand,
  pillars: Pillar[],
  mediaId: string,
): Promise<Pillar> {
  if (pillars.length === 0) throw new Error("classifyPhotoPillar: brand has no pillars");
  const fallback = pillars[0]!;
  if (pillars.length === 1) return fallback;
  const blob = await getMedia(mediaId);
  if (!blob || !blob.contentType.startsWith("image/")) return fallback;

  try {
    const small = await sharp(Buffer.from(blob.bytes))
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    const list = pillars.map((p) => `- ${p.key}: ${p.name} — ${p.description}`).join("\n");
    const system = [
      `You sort a client's photo into ONE content pillar for "${brand.name}"'s social media.`,
      "Pillars:",
      list,
      "Reply with ONLY the pillar key (the bit before the colon), nothing else.",
    ].join("\n");
    const content: ContentPart[] = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
      { type: "text", text: "Which pillar key fits this photo best?" },
    ];
    const out = (
      await callLLM({
        system,
        messages: [{ role: "user", content }],
        maxTokens: 20,
        tier: "fast",
        task: "pillar_label",
      })
    )
      .trim()
      .toLowerCase();
    const match = pillars.find((p) => out.includes(p.key)) ?? pillars.find((p) => out.includes(p.name.toLowerCase()));
    return match ?? fallback;
  } catch (err) {
    console.error("classifyPhotoPillar failed", err);
    return fallback;
  }
}

/**
 * Parse a conversational scheduling/settings instruction into pillar updates and
 * apply them. Returns a confirmation string, or null if the message isn't a
 * pillar/schedule config (so the caller can fall through to normal handling).
 */
export async function configurePillarsFromMessage(
  brand: Brand,
  pillars: Pillar[],
  message: string,
): Promise<string | null> {
  const list = pillars
    .map((p) => `- ${p.key} (${p.name}): ${p.posts_per_week}/week, autopilot ${p.autopilot ? "on" : "off"}, ${describePin((p as { schedule_pin?: unknown }).schedule_pin)}`)
    .join("\n");
  const system = [
    "You turn a client's scheduling instruction into structured updates to their content pillars.",
    `Their pillars:\n${list}`,
    'Output ONLY JSON: {"updates":[{"key":"<pillar key>","posts_per_week":<int optional>,"autopilot":<bool optional>,"schedule_pin":<pin object, null to clear, or omitted to leave unchanged>}],"reply":"<one friendly sentence confirming>"}',
    'If the message is NOT about scheduling/cadence/autopilot/timing for these pillars, output {"updates":[],"reply":""} exactly.',
    'Interpret phrases: "every weekday"=5, "daily"=7, "a few times a week"=3, "once a week"=1. "on autopilot"/"post automatically"=autopilot true. "always ask me"/"check with me"=autopilot false.',
    "Fixed day/time requests pin that pillar to an exact slot:",
    '  "every Tuesday at 6pm" → {"mode":"weekly","weekdays":[2],"hour":18,"minute":0}.',
    '  "Mondays and Thursdays at 5:30pm" → {"mode":"weekly","weekdays":[1,4],"hour":17,"minute":30}.',
    '  "on the 1st at 9am" / "first of every month" → {"mode":"monthly","monthDays":[1],"hour":9,"minute":0}.',
    "  Weekdays are Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6. Hours are 24h (6pm=18). Default minute 0; 'half past'=30.",
    "  When the client pins N days and states no other cadence, set posts_per_week to N.",
    '  "mix it up" / "anytime" / "vary it" / "no fixed time" clears the pin → schedule_pin null.',
    "  The reply must name the pinned day(s) and time when a pin is set or cleared.",
  ].join("\n");
  let parsed: {
    updates?: Array<{
      key: string;
      posts_per_week?: number;
      autopilot?: boolean;
      schedule_pin?: SchedulePin | null;
    }>;
    reply?: string;
  };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 400 });
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const updates = (parsed.updates ?? []).filter((u) => pillars.some((p) => p.key === u.key));
  if (updates.length === 0) return null;

  for (const u of updates) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof u.posts_per_week === "number") {
      vals.push(Math.max(0, Math.min(14, Math.round(u.posts_per_week))));
      sets.push(`posts_per_week = $${vals.length}`);
    }
    if (typeof u.autopilot === "boolean") {
      vals.push(u.autopilot);
      sets.push(`autopilot = $${vals.length}`);
    }
    if ("schedule_pin" in u) {
      if (u.schedule_pin === null) {
        vals.push("{}");
        sets.push(`schedule_pin = $${vals.length}::jsonb`);
      } else {
        const pin = schedulePinSchema.safeParse(u.schedule_pin);
        if (pin.success && pin.data.mode !== "flex") {
          vals.push(JSON.stringify(pin.data));
          sets.push(`schedule_pin = $${vals.length}::jsonb`);
        }
      }
    }
    if (sets.length === 0) continue;
    vals.push(brand.id, u.key);
    try {
      await query(`update pillars set ${sets.join(", ")} where brand_id = $${vals.length - 1} and key = $${vals.length}`, vals);
    } catch (err) {
      // A DB without migration 0021 has no schedule_pin column — persist the
      // non-pin fields so a fixed-time request still updates cadence.
      if (sets.some((s) => s.startsWith("schedule_pin")) && sets.length > 1) {
        const keptSets = sets.filter((s) => !s.startsWith("schedule_pin"));
        const keptVals = vals.slice(0, vals.length - 2);
        keptVals.push(brand.id, u.key);
        const remapped = keptSets.map((s, i) => s.replace(/\$\d+/, `$${i + 1}`));
        await query(
          `update pillars set ${remapped.join(", ")} where brand_id = $${keptVals.length - 1} and key = $${keptVals.length}`,
          keptVals,
        );
      } else throw err;
    }
  }
  return parsed.reply && parsed.reply.trim().length > 0
    ? parsed.reply.trim()
    : "Done, I've updated your posting schedule.";
}
