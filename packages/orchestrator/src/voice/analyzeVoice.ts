import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import {
  query,
  queryOne,
  brandVoiceProfileSchema,
  photoStyleSchema,
  writingMechanicsSchema,
} from "@pulse/shared";
import type {
  Brand,
  BrandVoiceProfile,
  PhotoStyle,
  Platform,
  VoiceAnalysisState,
} from "@pulse/shared";
import { harvestBrandPosts, type HarvestedPost } from "@pulse/graph";
import { callLLM } from "../llm.js";
import { computeTextStats, type TextStats } from "./textStats.js";

// The onboarding voice agent. Runs once, on the worker, right after a client
// connects their accounts. It reads their real post history, learns exactly how
// they write and shoot, and writes it all down — a detailed voice guide plus an
// enriched structured profile — so every future draft sounds like them.

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

// Smart sample (see onboarding decision): recent window + top performers, and a
// representative slice of images through vision. Voice converges fast; reading
// everything is money set alight for marginal signal.
const RECENT_WINDOW = 150;
const TOP_PERFORMERS = 30;
const MAX_PER_PLATFORM = 200;
const VISION_IMAGE_CAP = 24;
const VISION_BATCH = 6;
const EXAMPLE_CAPTIONS = 8;

async function setState(brandId: string, patch: Partial<VoiceAnalysisState>): Promise<void> {
  const row = await queryOne<{ voice_analysis_state: VoiceAnalysisState }>(
    "select voice_analysis_state from brands where id = $1",
    [brandId],
  );
  const next: VoiceAnalysisState = { status: "none", ...(row?.voice_analysis_state ?? {}), ...patch };
  await query("update brands set voice_analysis_state = $1::jsonb where id = $2", [JSON.stringify(next), brandId]);
}

/** Newest-first + top-by-engagement, de-duplicated. The "smart sample". */
function sample(posts: HarvestedPost[]): HarvestedPost[] {
  const byTime = [...posts].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  const recent = byTime.slice(0, RECENT_WINDOW);
  const top = [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, TOP_PERFORMERS);
  const seen = new Set<string>();
  const out: HarvestedPost[] = [];
  for (const p of [...recent, ...top]) {
    if (seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    out.push(p);
  }
  return out;
}

/** Spread image choices across platforms and time so vision sees variety. */
function pickImages(posts: HarvestedPost[]): { url: string; platform: Platform }[] {
  const withImages = posts.filter((p) => p.imageUrls.length > 0);
  // Interleave by engagement so strong posts lead, but cap per platform so one
  // channel doesn't dominate the visual read.
  const ranked = [...withImages].sort((a, b) => b.engagement - a.engagement);
  const perPlatform = new Map<Platform, number>();
  const out: { url: string; platform: Platform }[] = [];
  for (const p of ranked) {
    if (out.length >= VISION_IMAGE_CAP) break;
    const used = perPlatform.get(p.platform) ?? 0;
    if (used >= Math.ceil(VISION_IMAGE_CAP / 1.5)) continue;
    perPlatform.set(p.platform, used + 1);
    out.push({ url: p.imageUrls[0]!, platform: p.platform });
  }
  return out;
}

/** Fetch + downscale an image to a vision-safe base64 JPEG. Null on any failure. */
async function fetchImagePart(url: string): Promise<ContentPart | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (out.byteLength > 4_500_000) return null;
    return {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: out.toString("base64") },
    };
  } catch {
    return null;
  }
}

/** Vision pass: describe the photo style from real images, in batches. */
async function analysePhotos(
  images: { url: string; platform: Platform }[],
): Promise<{ photoStyle: PhotoStyle; analysed: number }> {
  const empty = photoStyleSchema.parse({});
  if (images.length === 0) return { photoStyle: empty, analysed: 0 };

  const batchNotes: string[] = [];
  let analysed = 0;

  for (let i = 0; i < images.length; i += VISION_BATCH) {
    const batch = images.slice(i, i + VISION_BATCH);
    const parts: ContentPart[] = [];
    for (const img of batch) {
      const part = await fetchImagePart(img.url);
      if (part) {
        parts.push(part);
        analysed++;
      }
    }
    if (parts.length === 0) continue;
    parts.push({
      type: "text",
      text:
        "These are real posts from one brand's feed. In 4-6 tight sentences, describe the shared visual style: " +
        "lighting, colour grading/editing, composition and framing, typical subjects, and any recurring motifs. " +
        "Describe only what you actually see. Plain prose.",
    });
    try {
      const note = await callLLM({ messages: [{ role: "user", content: parts }], maxTokens: 400 });
      batchNotes.push(note.trim());
    } catch {
      /* a failed batch just contributes nothing */
    }
  }

  if (batchNotes.length === 0) return { photoStyle: empty, analysed };

  try {
    const raw = await callLLM({
      system:
        "You consolidate several descriptions of one brand's photo style into a single structured profile. Output ONLY JSON: " +
        '{"overall_aesthetic":string,"lighting":string,"composition":string,"colour_palette":string[],' +
        '"editing":string,"common_subjects":string[],"framing":string,"recurring_motifs":string[]}. ' +
        "Keep strings short and concrete; arrays 2-5 items.",
      messages: [{ role: "user", content: batchNotes.map((n, i) => `Batch ${i + 1}: ${n}`).join("\n\n") }],
      maxTokens: 500,
    });
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { photoStyle: photoStyleSchema.parse(json), analysed };
  } catch {
    return { photoStyle: photoStyleSchema.parse({ overall_aesthetic: batchNotes[0] ?? "" }), analysed };
  }
}

/** Pick a handful of real, representative captions to store as voice examples. */
function pickExampleCaptions(posts: HarvestedPost[]): string[] {
  const caps = posts
    .filter((p) => p.caption && p.caption.trim().length > 0)
    .sort((a, b) => b.engagement - a.engagement)
    .map((p) => p.caption!.trim().slice(0, 400));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of caps) {
    const key = c.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= EXAMPLE_CAPTIONS) break;
  }
  return out;
}

interface VoiceTextResult {
  tone: string[];
  dos: string[];
  donts: string[];
  banned_words: string[];
  hashtag_policy: string;
  writing_mechanics: BrandVoiceProfile["writing_mechanics"];
  voice_notes: string;
}

/** Text pass: derive tone + mechanics from the captions, grounded by hard stats. */
async function analyseText(captions: string[], stats: TextStats): Promise<VoiceTextResult> {
  const corpus = captions.slice(0, 120).map((c, i) => `${i + 1}. ${c.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const raw = await callLLM({
    system:
      "You are a brand-voice analyst. From a client's real post captions AND the exact computed statistics provided, " +
      "produce a precise profile of how THIS person writes. Trust the statistics for frequencies; use the captions for " +
      "flavour, phrasing and tone. Output ONLY JSON matching:\n" +
      '{"tone":string[],"dos":string[],"donts":string[],"banned_words":string[],"hashtag_policy":string,' +
      '"writing_mechanics":{"emoji_frequency":string,"favourite_emojis":string[],"exclamation_usage":string,' +
      '"ellipsis_usage":string,"capitalisation":string,"sentence_length":string,"punctuation_quirks":string[],' +
      '"openers":string[],"sign_offs":string[],"hashtag_style":string,"cta_style":string,"favourite_phrases":string[]},' +
      '"voice_notes":string}\n' +
      "Be specific and concrete (quote real phrases they actually use). Keep arrays short. Describe frequencies in plain " +
      "words anchored to the stats (e.g. 'emojis on ~7 in 10 posts, usually 🔥 and ✨, always trailing').",
    messages: [
      {
        role: "user",
        content:
          `COMPUTED STATISTICS (ground truth):\n${JSON.stringify(stats, null, 2)}\n\n` +
          `CAPTIONS:\n${corpus}`,
      },
    ],
    maxTokens: 1200,
  });
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return {
      tone: arr(json.tone),
      dos: arr(json.dos),
      donts: arr(json.donts),
      banned_words: arr(json.banned_words),
      hashtag_policy: str(json.hashtag_policy),
      writing_mechanics: writingMechanicsSchema.parse(json.writing_mechanics ?? {}),
      voice_notes: str(json.voice_notes),
    };
  } catch {
    return {
      tone: [],
      dos: [],
      donts: [],
      banned_words: [],
      hashtag_policy: "",
      writing_mechanics: writingMechanicsSchema.parse({}),
      voice_notes: "",
    };
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function uniq(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item.trim());
    }
  }
  return out;
}

/** Derive the emoji policy from real usage — data beats a questionnaire guess. */
function emojiPolicyFromStats(stats: TextStats): BrandVoiceProfile["emoji_policy"] {
  if (stats.postsWithEmojiPct < 8) return "none";
  if (stats.emojiPerPost >= 1.5 || stats.postsWithEmojiPct >= 70) return "liberal";
  return "sparing";
}

/** Write the long-form, human-readable voice guide (the "bible"). */
async function writeVoiceGuide(
  brand: Brand,
  profile: BrandVoiceProfile,
  stats: TextStats,
  platforms: Platform[],
): Promise<string> {
  try {
    const guide = await callLLM({
      system:
        "You write a detailed brand-voice guide in Markdown for an internal team who will write future posts in this " +
        "person's exact voice. Be specific and practical — quote their real phrases, give concrete rules, note the exact " +
        "frequencies from the stats. Sections: Snapshot (3-4 lines a writer can skim), Tone & Personality, Writing " +
        "Mechanics (emoji, punctuation, capitalisation, sentence length, openers, sign-offs, hashtags, CTAs — with the " +
        "real numbers), Photo & Visual Style, Do / Don't, and Example Captions (their real ones). No preamble.",
      messages: [
        {
          role: "user",
          content:
            `Brand: ${brand.name}\nPlatforms analysed: ${platforms.join(", ") || "n/a"}\n\n` +
            `STRUCTURED PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
            `COMPUTED STATISTICS:\n${JSON.stringify(stats, null, 2)}`,
        },
      ],
      maxTokens: 2000,
    });
    return guide.trim();
  } catch {
    return "";
  }
}

/**
 * Run the full voice analysis for a brand. Idempotent-ish: safe to re-run when a
 * client connects another platform later — it re-harvests and rewrites. Never
 * throws to the caller; failures are recorded in voice_analysis_state.
 */
export async function runVoiceAnalysis(brandId: string): Promise<VoiceAnalysisState> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`runVoiceAnalysis: brand ${brandId} not found`);

  await setState(brandId, { status: "running", started_at: new Date().toISOString(), error: undefined });

  try {
    const { posts, platforms } = await harvestBrandPosts(brand, MAX_PER_PLATFORM);
    if (posts.length === 0) {
      const skipped: VoiceAnalysisState = {
        status: "skipped",
        completed_at: new Date().toISOString(),
        posts_analysed: 0,
        images_analysed: 0,
        platforms,
      };
      await setState(brandId, skipped);
      return skipped;
    }

    const sampled = sample(posts);
    const captions = sampled.map((p) => p.caption ?? "");
    const stats = computeTextStats(captions);

    const [text, photos] = await Promise.all([
      analyseText(sampled.map((p) => p.caption ?? "").filter((c) => c.trim().length > 0), stats),
      analysePhotos(pickImages(sampled)),
    ]);

    // Merge with whatever the chat interview already learned — union, don't clobber.
    const existing = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
    const exampleCaptions = uniq(pickExampleCaptions(sampled), existing.example_captions).slice(0, EXAMPLE_CAPTIONS);

    const merged: BrandVoiceProfile = brandVoiceProfileSchema.parse({
      tone: uniq(existing.tone, text.tone).slice(0, 8),
      dos: uniq(existing.dos, text.dos).slice(0, 12),
      donts: uniq(existing.donts, text.donts).slice(0, 12),
      example_captions: exampleCaptions,
      banned_words: uniq(existing.banned_words, text.banned_words),
      emoji_policy: emojiPolicyFromStats(stats),
      hashtag_policy: text.hashtag_policy || existing.hashtag_policy,
      notes: existing.notes, // corrections are sacred — never overwrite
      writing_mechanics: text.writing_mechanics,
      photo_style: photos.photoStyle,
      analysis_source: `${sampled.length} posts (${platforms.join(", ") || "none"}); ${photos.analysed} images`,
    });

    const guide = await writeVoiceGuide(brand, merged, stats, platforms);

    await query("update brands set brand_voice_profile = $1::jsonb, voice_guide_md = $2 where id = $3", [
      JSON.stringify(merged),
      guide || null,
      brandId,
    ]);

    // Feed the drafter's other input too: keep a concise voice note in sync.
    if (text.voice_notes) {
      await query(
        `insert into strategy_notes (brand_id, voice_notes, content_mix)
         values ($1, $2, '{}'::jsonb)
         on conflict (brand_id) do update set voice_notes = excluded.voice_notes, last_updated = now()`,
        [brandId, text.voice_notes],
      );
    }

    const done: VoiceAnalysisState = {
      status: "done",
      completed_at: new Date().toISOString(),
      posts_analysed: sampled.length,
      images_analysed: photos.analysed,
      platforms,
    };
    await setState(brandId, done);
    return done;
  } catch (err) {
    const failed: VoiceAnalysisState = {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    await setState(brandId, failed);
    return failed;
  }
}

/** Queue the analysis (called when accounts connect); the worker picks it up. */
export async function queueVoiceAnalysis(brandId: string): Promise<void> {
  await query(
    `update brands set voice_analysis_state =
       jsonb_build_object('status','pending','queued_at', to_jsonb(now()::text))
     where id = $1
       and coalesce(voice_analysis_state->>'status','none') <> 'running'`,
    [brandId],
  );
}
