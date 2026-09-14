import { randomUUID } from "node:crypto";
import {
  query,
  queryOne,
  putMedia,
  brandVoiceProfileSchema,
  sanitizeChatText,
  type Brand,
  type Pillar,
  type Post,
  type PostFormat,
} from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { inferContentJob, formatBiasForJob } from "./contentJobs.js";
import { humanizeCaption } from "./humanizeCaption.js";
import {
  editImageForBrand,
  gradePhotoBundle,
  applyStoryCreative,
  generateHeadline,
  generatePhotoImage,
  applyTextTile,
  brandPhotoStyleBits,
} from "./imaging.js";
import {
  facelessPromptLine,
  facelessPhotoConstraint,
  isFacelessBrand,
  overlayMasthead,
  stripPersonalNames,
} from "./faceless.js";
import {
  looksLikeCityscapeBrief,
  looksLikeComparisonBrief,
  reinforceTopicHint,
  reviewBriefCompliance,
} from "./briefCompliance.js";
import { visualReference } from "./library.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { ensurePillars, classifyPhotoPillar } from "./pillars.js";
import { callLLM } from "./llm.js";
import { mapWithConcurrency, SLIDE_RENDER_CONCURRENCY } from "./concurrency.js";
import {
  composeAndStoreSlide,
  gatherDesignContext,
  layoutForIndex,
  rolesForCarouselKind,
  type LayoutPrimitive,
  type SlideRole,
} from "./designComposer.js";
import {
  resolveDestinationLink,
  buildLinkOffer,
  storyLinkCta,
} from "./destinationLinks.js";
import type { LinkOffer } from "@pulse/shared";
import { ensureDesignQa, runDesignQa, designQaFailureSms, type DesignQaFixHints } from "./designQa.js";
import { routeImageJob } from "./modelRouter.js";

/** Brand visual DNA for photo prompts — prefer ./visualDna.js when present. */
async function gatherVisualDnaForBrand(brand: Brand): Promise<string> {
  try {
    const mod = await import("./visualDna.js");
    if (typeof mod.gatherVisualDna === "function") {
      const dna = await mod.gatherVisualDna(brand);
      if (typeof mod.visualDnaPromptLine === "function") {
        const line = mod.visualDnaPromptLine(dna);
        if (line?.trim()) return line.trim();
      }
      const block = (dna as { promptBlock?: unknown }).promptBlock;
      if (typeof block === "string" && block.trim()) return block.trim();
    }
  } catch {
    /* module not shipped yet */
  }
  const bits = [
    visualReference(brand, false),
    ...brandPhotoStyleBits(brand),
    facelessPromptLine(brand) ?? "",
    facelessPhotoConstraint(brand),
  ].filter(Boolean);
  return bits.join(". ");
}

// Post-format handling. When several photos arrive at once we don't guess — we
// park them as a holding 'draft' carousel and ask "carousel or separate?", then
// resolve on the client's answer.

const CAROUSEL_YES = /\b(carousel|one post|together|swipe|swipeable|bundle|all in one|combined?|as one)\b/i;
const SEPARATE_YES = /\b(separate|separately|individual|split|apart|each|different posts?|on their own|one by one)\b/i;

export type TypedCarouselKind = "tip" | "before_after" | "steps" | "menu_offer";

/** Read a carousel-vs-separate answer from the client's reply. */
export function carouselDecision(body: string): "carousel" | "separate" | null {
  if (SEPARATE_YES.test(body)) return "separate";
  if (CAROUSEL_YES.test(body)) return "carousel";
  return null;
}

/** The holding 'draft' carousel awaiting a carousel-or-separate answer, if any. */
export async function getPendingCarouselChoice(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
      where brand_id = $1 and status = 'draft' and format = 'carousel'
        and created_at > now() - interval '30 minutes'
      order by created_at desc
      limit 1`,
    [brandId],
  );
}

/** Park several photos as a holding carousel draft until the client decides. */
export async function parkCarouselChoice(brandId: string, photoIds: string[]): Promise<void> {
  await query(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, format, platform, status)
     values ($1, null, $2::uuid[], $2::uuid[], 'carousel', 'instagram', 'draft')`,
    [brandId, photoIds],
  );
}

async function scheduleFor(
  brand: Brand,
  pillarId: string | null,
  postsPerWeek: number,
  format?: PostFormat | null,
): Promise<Date> {
  return scheduleSlot({ brandId: brand.id, platform: "instagram", pillarId, postsPerWeek, format });
}

/**
 * Parse "50% carousel, 30% feed, 20% story" style mix strings into weights.
 * Exported for unit tests (C5). Also accepts "reel".
 */
export function weightsFromFormatMix(mix: string | null | undefined): Array<[PostFormat, number]> | null {
  if (!mix) return null;
  const found: Partial<Record<PostFormat, number>> = {};
  const re = /(\d{1,3})\s*%\s*(carousel|feed|story|reel)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mix))) {
    const n = Number(m[1]);
    const f = m[2]!.toLowerCase() as PostFormat;
    if (n > 0 && (f === "carousel" || f === "feed" || f === "story" || f === "reel")) found[f] = n;
  }
  const entries = Object.entries(found) as Array<[PostFormat, number]>;
  return entries.length ? entries : null;
}

/** Turn the parked photos into ONE carousel post (consistent grade across slides). */
export async function resolveAsCarousel(
  brand: Brand,
  draft: Post,
): Promise<{ post: Post; mediaUrl: string | null } | null> {
  const ids = draft.source_media_ids ?? draft.media_ids;
  if (ids.length === 0) return null;
  if (ids.length < 2) {
    // Never corrupt a 1-slide "carousel".
    return null;
  }

  // C6: caption + shared grade in parallel where safe.
  const [captionResult, mediaIds] = await Promise.all([
    draftCaption(brand.id, ids),
    gradePhotoBundle(brand, ids),
  ]);
  const caption = captionResult.caption;

  const pillars = await ensurePillars(brand.id);
  const pillar = await classifyPhotoPillar(brand, pillars, ids[0]!);
  const autopilot = Boolean(pillar?.autopilot);
  const slot = await scheduleFor(brand, pillar?.id ?? null, pillar?.posts_per_week ?? 0, 'carousel');

  const post = await queryOne<Post>(
    `update posts set caption = $1, media_ids = $2::uuid[], pillar_id = $3, is_auto = $4,
        hold_notified_at = $5, status = $6, scheduled_at = $7
      where id = $8 returning *`,
    [
      caption,
      mediaIds,
      pillar?.id ?? null,
      autopilot,
      autopilot ? new Date().toISOString() : null,
      autopilot ? "scheduled" : "pending_approval",
      slot.toISOString(),
      draft.id,
    ],
  );
  if (!post) return null;
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({ caption, format: "carousel", slides: mediaIds.length, grade: "shared" }),
      "Carousel drafted from multiple photos (consistent grade)",
    ],
  ).catch(() => {});
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}

// ─── Format variety ─────────────────────────────────────────────────────────

/**
 * Pick the next format to keep the feed varied. Prefers the accepted content
 * plan / pillar format_bias when present; otherwise carousel-leaning defaults.
 * Avoids immediately repeating the most-recent format.
 */
export async function chooseNextFormat(
  brandId: string,
  pillarId?: string | null,
): Promise<PostFormat> {
  const recent = await query<{ format: PostFormat }>(
    `select format from posts
      where brand_id = $1 and status in ('pending_approval','approved','scheduled','published')
      order by created_at desc limit 5`,
    [brandId],
  );
  const last = recent[0]?.format;

  let preferred: PostFormat | null = null;
  let mixWeights: Array<[PostFormat, number]> | null = null;

  if (pillarId) {
    try {
      const row = await queryOne<{ format_bias: PostFormat | null; key?: string; name?: string; description?: string }>(
        `select format_bias, key, name, description from pillars where id = $1 and brand_id = $2`,
        [pillarId, brandId],
      );
      if (row?.format_bias && ["feed", "carousel", "story", "reel"].includes(row.format_bias)) {
        preferred = row.format_bias;
      } else if (row) {
        // No explicit bias — derive from content job (Reels for discovery jobs).
        const job = inferContentJob({
          key: (row as { key?: string }).key,
          name: (row as { name?: string }).name,
          description: (row as { description?: string }).description,
        });
        preferred = formatBiasForJob(job, { needDiscovery: true });
      }
    } catch {
      /* column may be missing pre-migration */
    }
  }

  if (!preferred || !mixWeights) {
    try {
      const accepted = await queryOne<{
        plan: {
          format_mix?: string;
          pillars?: Array<{ format_bias?: PostFormat }>;
        } | null;
      }>(
        `select plan from content_plans where brand_id = $1 and status = 'accepted'
          order by updated_at desc limit 1`,
        [brandId],
      );
      mixWeights = weightsFromFormatMix(accepted?.plan?.format_mix ?? null);
      if (!preferred) {
        const biases = (accepted?.plan?.pillars ?? [])
          .map((p) => p.format_bias)
          .filter((f): f is PostFormat => f === "feed" || f === "carousel" || f === "story" || f === "reel");
        if (biases.length) {
          const counts: Record<string, number> = {};
          for (const b of biases) counts[b] = (counts[b] ?? 0) + 1;
          preferred =
            (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as PostFormat) ?? null;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const weights: Array<[PostFormat, number]> = mixWeights
    ? mixWeights
    : preferred
      ? [
          [preferred, 7],
          ...(
            [
              ["carousel", 3],
              ["feed", 2],
              ["story", 1],
              ["reel", 2],
            ] as Array<[PostFormat, number]>
          ).filter(([f]) => f !== preferred),
        ]
      : [
          ["carousel", 4],
          ["feed", 3],
          ["reel", 2],
          ["story", 1],
        ];

  const pool = weights.filter(([f]) => f !== last);
  const use = pool.length ? pool : weights;
  const total = use.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [f, w] of use) {
    r -= w;
    if (r <= 0) return f;
  }
  return preferred ?? "carousel";
}

/**
 * Judge whether story content is a casual candid (safe to auto-post) or salesy —
 * a claim, price, offer or promo — which must wait for the owner's yes.
 */
export async function classifyStoryTone(brand: Brand, text: string): Promise<"candid" | "salesy"> {
  if (!text.trim()) return "candid";
  try {
    const verdict = await callLLM({
      system: [
        `Classifying a Story for "${brand.name}". Is it a casual, behind-the-scenes CANDID, or SALESY (a price, discount, offer, guarantee, or a factual claim/promotion)?`,
        'Answer with exactly one word: "candid" or "salesy". When unsure, answer "salesy".',
      ].join("\n"),
      messages: [{ role: "user", content: text.slice(0, 500) }],
      maxTokens: 5,
    });
    return /salesy/i.test(verdict) ? "salesy" : "candid";
  } catch {
    return "salesy"; // fail safe — gate it
  }
}

/**
 * Intentional short/overlay path for Stories — NOT a full feed caption
 * (Phase C4). Returns overlay + optional CTA only.
 */
export async function draftStoryOverlay(
  brand: Brand,
  mediaId: string,
): Promise<{ overlay: string; cta?: string }> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  try {
    const raw = await callLLM({
      system: [
        `Write STORY overlay copy for "${brand.name}" — Instagram Stories are ephemeral and vertical.`,
        "Do NOT write a feed-length caption. Output ONLY JSON:",
        '{"overlay":"<3-7 punchy words>","cta":"<optional short CTA or empty>","sticker":"none|question|poll|link","question_prompt":"<if sticker=question, the question to ask>","sell":true|false}',
        "Prefer a question sticker when you want audience words for future hooks, or a soft sell CTA when an offer/booking link fits. Keep sell sparse.",
        facelessPromptLine(brand) ?? "",
        profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
        "No hashtags, no emoji spam, no quotes.",
      ]
        .filter(Boolean)
        .join("\n"),
      messages: [
        {
          role: "user",
          content: `Photo media id ${mediaId}. Write the story overlay now.`,
        },
      ],
      maxTokens: 80,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      overlay?: string;
      cta?: string;
    };
    const overlay = stripPersonalNames(humanizeCaption(String(parsed.overlay ?? "")), brand).slice(0, 48);
    let cta = stripPersonalNames(humanizeCaption(String(parsed.cta ?? "")), brand).slice(0, 48);
    const sticker = String((parsed as { sticker?: string }).sticker ?? "none");
    const q = humanizeCaption(String((parsed as { question_prompt?: string }).question_prompt ?? "")).slice(0, 60);
    if (sticker === "question" && q && !cta) cta = q;
    if (overlay) return { overlay, cta: cta || undefined };
  } catch (err) {
    console.error("draftStoryOverlay failed", err);
  }
  const masthead = overlayMasthead(brand);
  return { overlay: (masthead || "START HERE").slice(0, 24) };
}

async function renderTypedSlides(
  brand: Brand,
  slides: string[],
  kind: TypedCarouselKind,
  forcedLayout?: LayoutPrimitive,
): Promise<{ mediaIds: string[]; layouts: LayoutPrimitive[]; roles: SlideRole[] }> {
  routeImageJob("designed_slide");
  await gatherDesignContext(brand); // cold-start bootstrap notes gathered (side-effect retrieval)
  const roles = rolesForCarouselKind(kind, slides.length);
  const layouts: LayoutPrimitive[] = slides.map((_, i) =>
    i === 0 && forcedLayout ? forcedLayout : layoutForIndex(i, slides.length, [], roles[i]),
  );

  const results = await mapWithConcurrency(slides, SLIDE_RENDER_CONCURRENCY, async (text, i) => {
    const role = roles[i] ?? "body";
    const layout = layouts[i]!;
    const { mediaId } = await composeAndStoreSlide(brand, text, {
      role,
      index: i,
      total: slides.length,
      layout,
    });
    return { mediaId, layout, role, i };
  });

  results.sort((a, b) => a.i - b.i);
  return {
    mediaIds: results.map((r) => r.mediaId),
    layouts: results.map((r) => r.layout),
    roles: results.map((r) => r.role),
  };
}

/**
 * Tip + typed generators (before/after, step-by-step, menu/offer).
 * Uses design composer primitives with variation — NOT N identical dark cards.
 * Always lands pending_approval. Slide renders are parallelized (C3/C6).
 */
export async function generateTypedCarousel(
  brand: Brand,
  pillar: Pillar,
  kind: TypedCarouselKind = "tip",
): Promise<
  | { ok: true; post: Post; mediaUrl: string }
  | { ok: false; qaSms: string }
  | null
> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const kindGuide: Record<TypedCarouselKind, string> = {
    tip: "value tip carousel: hook + tips + CTA",
    before_after: "before/after carousel: hook, BEFORE state, AFTER state, CTA",
    steps: "step-by-step how-to: hook, numbered steps, CTA",
    menu_offer: "menu/offer carousel: hook, items or offer beats, CTA — only use real offers if known",
  };

  const system = [
    `You write a ${kindGuide[kind]} for "${brand.name}" in the "${pillar.name}" pillar (${pillar.description}).`,
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    'Output ONLY JSON: {"caption":"<short feed caption>","slides":["<slide 1>","<slide 2>",...]}',
    "3 to 5 slides. Each slide is ONE short punchy line (max about 10 words). No emoji, no quotes, no dashes of any kind.",
    kind === "before_after" ? "Slide 2 should read as BEFORE; slide 3 as AFTER." : "",
    kind === "steps" ? "Middle slides are sequential steps (do not number them; we render numbers)." : "",
  ]
    .filter(Boolean)
    .join("\n");

  let caption: string;
  let slides: string[];
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: `Write today's ${pillar.name} ${kind} carousel.` }],
      maxTokens: 400,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    caption = sanitizeChatText(String(parsed.caption ?? ""));
    slides = Array.isArray(parsed.slides)
      ? parsed.slides.map((s: unknown) => sanitizeChatText(String(s))).filter(Boolean).slice(0, 8)
      : [];
    if (!caption || slides.length < 2) return null;
  } catch (err) {
    console.error(`generateTypedCarousel(${kind}): LLM/parse failed`, err);
    return null;
  }

  let rendered: { mediaIds: string[]; layouts: LayoutPrimitive[] };
  try {
    rendered = await renderTypedSlides(brand, slides, kind);
  } catch (err) {
    console.error(`generateTypedCarousel(${kind}): render failed`, err);
    return null;
  }

  // Mid-render failure: do not insert a half-empty post.
  if (rendered.mediaIds.length !== slides.length) return null;

  const qa = await ensureDesignQa({
    brand,
    mediaIds: rendered.mediaIds,
    slideTexts: slides,
    layoutKey: rendered.layouts[0],
    recompose: async (suggest) => {
      const again = await renderTypedSlides(brand, slides, kind, suggest);
      return { mediaIds: again.mediaIds, layoutKey: again.layouts[0] };
    },
  });

  if (!qa.qa.pass) {
    // Honest SMS path — do not insert a half-baked / off-brand carousel.
    return { ok: false, qaSms: designQaFailureSms(brand.name) };
  }

  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week, 'carousel');
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, format, pillar_id, is_auto, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], 'carousel', $4, false, 'instagram', 'pending_approval', $5)
     returning *`,
    [brand.id, caption, qa.mediaIds, pillar.id, slot.toISOString()],
  );
  if (!post) return null;
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({
        caption,
        format: "carousel",
        slides: qa.mediaIds.length,
        kind,
        layouts: rendered.layouts,
        qa_recomposed: qa.recomposed,
      }),
      `AI ${kind} carousel via design composer`,
    ],
  ).catch(() => {});
  return { ok: true, post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}


/**
 * Photo + burned-in text carousel (the SMS "make me a carousel with cinematic
 * car photos + text overlay" path). Each slide is a generated still with a
 * short overlay — NOT a single feed filler, and NOT a designed tip card.
 * When the brief asks for business/AI ideas, research concrete ideas and put
 * ONE idea per slide.
 */
export function wantsResearchedIdeaSlides(topic: string | null | undefined): boolean {
  const t = (topic ?? "").trim();
  if (!t) return false;
  return /\b((ai|artificial intelligence|ml|machine learning)\s+)?(business|startup|side[- ]?hustle|venture|product|saas)\s+ideas?\b|\bideas?\s+(for|about|on)\s+(ai|business|startups?|making money|side[- ]?hustles?)\b|\bone idea per\b|\bresearch(ed)?\s+(into\s+)?(them|ideas?)\b/i.test(
    t,
  );
}

export async function generatePhotoTextCarousel(
  brand: Brand,
  pillar: Pillar,
  opts?: { topicHint?: string | null; forceFresh?: boolean },
): Promise<
  | { ok: true; post: Post; mediaUrl: string; mediaUrls: string[] }
  | { ok: false; qaSms: string }
  | null
> {
  const topic = (opts?.topicHint ?? "").trim().slice(0, 400);
  const forceFresh = opts?.forceFresh === true;
  const ideaMode = wantsResearchedIdeaSlides(topic);
  const facelessLine = facelessPromptLine(brand) ?? "";
  const noFace = facelessPhotoConstraint(brand);
  const visualDna = await gatherVisualDnaForBrand(brand);
  let photoQuality: "draft" | "standard" | "premium" = ideaMode ? "premium" : "standard";
  try {
    const { planFromOwnerText } = await import("./creativePlan.js");
    photoQuality = planFromOwnerText(topic || "photo carousel", brand).quality;
  } catch {
    /* creativePlan optional */
  }
  const system = [
    `You write a swipeable Instagram carousel for "${brand.name}" in the "${pillar.name}" pillar (${pillar.description}).`,
    facelessLine,
    visualDna ? `Visual DNA (match this look): ${visualDna}` : "",
    topic ? `Owner brief (follow to the letter — every constraint matters): ${topic}` : "",
    looksLikeComparisonBrief(topic)
      ? "COMPARISON brief: each relevant overlay/caption must name specific options and state a concrete difference — category tips without named tools FAIL."
      : "",
    looksLikeCityscapeBrief(topic)
      ? "VISUAL brief: every photo_prompt MUST be a cinematic cityscape / skyline (urban dusk or night lights), not desks or offices."
      : "",
    ideaMode
      ? 'Output ONLY JSON: {"caption":"<short feed caption ≤220 chars naming that these are researched ideas>","slides":[{"overlay":"<idea title ≤8 words>","photo_prompt":"<one sentence: photoreal subject matching the visual brief + place + lighting>","idea_blurb":"<2 sentences burned on the slide: what the product/service is, who pays, why now — concrete, ≤220 chars>"}]}'
      : 'Output ONLY JSON: {"caption":"<short feed caption ≤220 chars>","slides":[{"overlay":"<max 8 words>","photo_prompt":"<one sentence: subject + place + lighting>"}]}',
    ideaMode
      ? "Aim for 5 slides (min 4). EACH slide is ONE distinct, concrete, researched AI/business idea (real product/service angle — not vague founder fluff like 'build systems' or 'stay hungry'). Overlay = short idea name. idea_blurb = richer detail that will be printed ON the photo (what it is + who buys + why now). Prefer AI / business ideas grounded in current market demand. No emoji. No personal names."
      : "4 to 5 slides. Each overlay is ONE short punchy line. No emoji. No personal names.",
    "photo_prompt must match the owner brief visual (e.g. cinematic cars if they asked for cars) — never invent unrelated portraits or office scenes.",
    "photo_prompt must read like a real photographer brief: specific make/model or vehicle class if cars, real location/time of day, lens feel — never 'epic AI fantasy' or abstract CGI.",
    noFace || "People in frame are fine when the brief calls for them; otherwise prefer clear subject photography.",
    "No text/logos/watermarks in the photo itself — overlay is burned on afterward.",
    ideaMode ? "Use web search to ground ideas in real demand/trends; do not invent fake statistics." : "",
  ]
    .filter(Boolean)
    .join("\n");

  let caption: string = "";
  let slides: Array<{ overlay: string; photoPrompt: string; ideaBlurb?: string }> = [];
  try {
    let briefForDraft = topic;
    let ok = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const attemptSystem =
        attempt === 0
          ? system
          : [
              system,
              briefForDraft && briefForDraft !== topic
                ? `COMPLIANCE RETRY — previous draft missed the brief. Fix: ${briefForDraft}`
                : "COMPLIANCE RETRY — previous draft missed the owner brief. Satisfy every constraint.",
            ]
              .filter(Boolean)
              .join("\n");
      const raw = await callLLM({
        system: attemptSystem,
        messages: [
          {
            role: "user",
            content: briefForDraft
              ? ideaMode
                ? `Research concrete ideas, then build the carousel for: ${briefForDraft}`
                : `Build the carousel for: ${briefForDraft}`
              : `Write today's ${pillar.name} photo carousel.`,
          },
        ],
        maxTokens: ideaMode ? 1600 : 900,
        webSearch: ideaMode ? 5 : undefined,
      });
      const startIdx = raw.indexOf("{");
      const endIdx = raw.lastIndexOf("}");
      if (startIdx < 0 || endIdx <= startIdx) {
        if (attempt === 0) continue;
        return null;
      }
      const parsed = JSON.parse(raw.slice(startIdx, endIdx + 1)) as {
        caption?: string;
        slides?: Array<{
          overlay?: string;
          photo_prompt?: string;
          photoPrompt?: string;
          idea_blurb?: string;
          ideaBlurb?: string;
        }>;
      };
      caption = stripPersonalNames(sanitizeChatText(String(parsed.caption ?? "")), brand).trim();
      slides = (parsed.slides ?? [])
        .map((s) => ({
          overlay: stripPersonalNames(sanitizeChatText(String(s.overlay ?? "")), brand)
            .replace(/["']/g, "")
            .trim()
            .slice(0, ideaMode ? 64 : 64),
          photoPrompt: String(s.photo_prompt ?? s.photoPrompt ?? "").trim(),
          ideaBlurb: stripPersonalNames(
            sanitizeChatText(String(s.idea_blurb ?? s.ideaBlurb ?? "")),
            brand,
          )
            .trim()
            .slice(0, ideaMode ? 220 : 180),
        }))
        .filter((s) => s.overlay && s.photoPrompt)
        .slice(0, 6);
      if (!caption || slides.length < 3) {
        if (attempt === 0) continue;
        return null;
      }
      // Soft first slide / opener frame is often the weakest photo — drop it when we have 5+.
      if (ideaMode && slides.length >= 5) {
        slides = slides.slice(1);
      }
      // Fold idea blurbs into caption so the SMS preview isn't empty fluff.
      if (ideaMode) {
        const ideaLines = slides
          .map((s, i) => (s.ideaBlurb ? `${i + 1}. ${s.overlay} — ${s.ideaBlurb}` : null))
          .filter(Boolean)
          .slice(0, 5);
        if (ideaLines.length) {
          caption = `${caption}\n\n${ideaLines.join("\n")}`.slice(0, 900);
        }
      }
      if (!topic) {
        ok = true;
        break;
      }
      const compliance = await reviewBriefCompliance({
        brief: topic,
        caption,
        overlays: slides.flatMap((s) => [s.overlay, s.ideaBlurb].filter(Boolean) as string[]),
        photoPrompts: slides.map((s) => s.photoPrompt),
        surface: "carousel",
      });
      if (compliance.pass) {
        ok = true;
        break;
      }
      console.warn("generatePhotoTextCarousel: brief compliance fail", compliance.reasons);
      if (attempt === 0) {
        briefForDraft = reinforceTopicHint(topic, compliance.reinforceHint);
        continue;
      }
    }
    if (!ok || !caption || slides.length < 3) return null;
  } catch (err) {
    console.error("generatePhotoTextCarousel: LLM/parse failed", err);
    return null;
  }


  const { FEED_PHOTO_REALISM_CUE } = await import("./ugc/presets/stillPresets.js");

  const ANGLE_CUES = [
    "low three-quarter angle, golden-hour rim light, wet asphalt reflections",
    "eye-level tracking-shot feel, long lens compression, shallow depth of field",
    "elevated wide establishing frame, misty dawn atmosphere",
    "tight detail crop of bodywork/wheel, cinematic bokeh city lights",
    "rear three-quarter, neon night reflections, premium editorial still",
  ];

  function mutatePhotoPrompt(base: string, pass: number, slideIndex: number): string {
    const cue = ANGLE_CUES[(slideIndex + pass) % ANGLE_CUES.length]!;
    return [
      base,
      `fresh unique frame (pass ${pass})`,
      cue,
      "distinct composition from any prior render — new angle, new lighting, new location detail",
      "photoreal cinematic photography matching the brief, no text, no watermark, no logo",
    ].join(". ");
  }

  // Owner redo / QA retry: diversify prompts before the first fal call so we
  // don't re-render near-identical frames from the prior pending set.
  if (forceFresh) {
    for (let i = 0; i < slides.length; i++) {
      slides[i]!.photoPrompt = mutatePhotoPrompt(slides[i]!.photoPrompt, 3, i);
      slides[i]!.overlay = slides[i]!.overlay.slice(0, 40);
      if (slides[i]!.ideaBlurb) {
        slides[i]!.ideaBlurb = slides[i]!.ideaBlurb!.slice(0, 120);
      }
    }
  }

  async function renderOneSlide(
    slide: { overlay: string; photoPrompt: string; ideaBlurb?: string },
    index: number,
    opts?: { strongerPhoto?: boolean; shortenOverlay?: boolean },
  ): Promise<string | null> {
    const stronger = opts?.strongerPhoto || index === 0;
    const dnaBit = visualDna || "";
    let prompt = [
      slide.photoPrompt,
      FEED_PHOTO_REALISM_CUE,
      dnaBit,
      stronger
        ? "hero composition, sharp subject, clean background, premium editorial still, photoreal not AI-slop"
        : "",
      noFace,
    ]
      .filter(Boolean)
      .join(". ");
    let img = await generatePhotoImage(prompt, "1:1", { quality: photoQuality, brief: topic || undefined });
    if (index === 0 && img && !opts?.strongerPhoto) {
      const retryPrompt = [
        slide.photoPrompt,
        FEED_PHOTO_REALISM_CUE,
        dnaBit,
        "hero composition, sharp subject, clean background, premium editorial still",
        noFace,
      ]
        .filter(Boolean)
        .join(". ");
      const retry = await generatePhotoImage(retryPrompt, "1:1", { quality: photoQuality, brief: topic || undefined });
      if (retry) img = retry;
    }
    if (!img) return null;
    const mediaId = randomUUID();
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [mediaId, brand.id, mediaId],
    );
    await putMedia(mediaId, new Uint8Array(img), "image/jpeg");

    let body = ideaMode ? slide.ideaBlurb || undefined : undefined;
    let eyebrow: string | undefined = ideaMode ? "IDEA" : undefined;
    let overlay = slide.overlay;
    if (opts?.shortenOverlay) {
      overlay = overlay.slice(0, 36);
      if (body) body = body.slice(0, 90);
      eyebrow = undefined;
    }
    const tiled = await applyTextTile(
      brand,
      mediaId,
      overlay,
      ideaMode || body
        ? {
            body,
            eyebrow,
            mixedFonts: ideaMode || Boolean(body),
          }
        : undefined,
    );
    return tiled ?? mediaId;
  }

  const mediaIds: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const id = await renderOneSlide(slides[i]!, i);
    if (!id) {
      console.error("generatePhotoTextCarousel: photo generation failed for a slide");
      return null;
    }
    mediaIds.push(id);
  }
  if (mediaIds.length < 3) return null;

  const slideTexts = slides.map((s) =>
    [s.overlay, s.ideaBlurb].filter(Boolean).join(" — "),
  );

  let qa = await ensureDesignQa({
    brand,
    mediaIds,
    slideTexts,
    layoutKey: "photo_overlay",
    mode: "photo_overlay",
    maxRecomposes: 3,
    recompose: async (_suggest, fixHints?: DesignQaFixHints, attempt = 1) => {
      const reasonsJoined = (fixHints?.reason ?? "").toLowerCase();
      const wantStrongerPhoto =
        Boolean(fixHints?.strongerPhoto) ||
        /photo|niche|slop|generic|ai-slop|ai sludge|clone|similar/.test(reasonsJoined);
      const wantShorter =
        Boolean(fixHints?.shortenOverlay) ||
        /illegib|overflow|clip|margin|too long|layout/.test(reasonsJoined);

      const rebuildAll = attempt >= 2;
      const targets = rebuildAll
        ? slides.map((_, idx) => idx)
        : [...new Set([0, Math.floor(slides.length / 2)])].filter((idx) => idx < slides.length);

      const next = [...mediaIds];
      const nextSlides = slides.map((s) => ({ ...s }));
      for (const idx of targets) {
        const slide = nextSlides[idx]!;
        if (wantStrongerPhoto || rebuildAll) {
          slide.photoPrompt = mutatePhotoPrompt(slide.photoPrompt, attempt, idx);
        }
        if (wantShorter || attempt >= 2) {
          slide.overlay = slide.overlay.slice(0, attempt >= 3 ? 28 : 40);
          if (slide.ideaBlurb) {
            slide.ideaBlurb = slide.ideaBlurb.slice(0, attempt >= 3 ? 70 : 110);
          }
        }
        const rebuilt = await renderOneSlide(slide, idx, {
          strongerPhoto: true,
          shortenOverlay: wantShorter || attempt >= 2,
        });
        if (rebuilt) next[idx] = rebuilt;
      }
      slides.splice(0, slides.length, ...nextSlides);
      const nextTexts = slides.map((s) =>
        [s.overlay, s.ideaBlurb].filter(Boolean).join(" — "),
      );
      return { mediaIds: next, layoutKey: "photo_overlay", slideTexts: nextTexts };
    },
  });

  let finalMediaIds = qa.mediaIds;
  let qaRecomposed = qa.recomposed;

  if (!qa.qa.pass) {
    // Final full-rebuild self-heal before we ever apologise.
    console.warn(
      "generatePhotoTextCarousel: QA still failing after recomposes — full rebuild",
      qa.qa.reasons,
    );
    const rebuiltIds: string[] = [];
    for (let idx = 0; idx < slides.length; idx++) {
      const slide = slides[idx]!;
      slide.photoPrompt = mutatePhotoPrompt(slide.photoPrompt, 9, idx);
      slide.overlay = slide.overlay.slice(0, 32);
      if (slide.ideaBlurb) slide.ideaBlurb = slide.ideaBlurb.slice(0, 90);
      const id = await renderOneSlide(slide, idx, { strongerPhoto: true, shortenOverlay: true });
      if (!id) {
        return { ok: false, qaSms: designQaFailureSms(brand.name) };
      }
      rebuiltIds.push(id);
    }
    const finalTexts = slides.map((s) =>
      [s.overlay, s.ideaBlurb].filter(Boolean).join(" — "),
    );
    const qa2 = await runDesignQa({
      brand,
      mediaIds: rebuiltIds,
      slideTexts: finalTexts,
      layoutKey: "photo_overlay",
      mode: "photo_overlay",
    });
    const hardFail = qa2.reasons.some((r) =>
      /illegib|overflow|empty|recompose failed/i.test(r),
    );
    if (!qa2.pass && hardFail) {
      return { ok: false, qaSms: designQaFailureSms(brand.name) };
    }
    if (!qa2.pass) {
      console.warn(
        "generatePhotoTextCarousel: soft QA remainders after full rebuild — shipping",
        qa2.reasons,
      );
    }
    qa = { qa: qa2, recomposed: true, mediaIds: rebuiltIds, attempts: (qa.attempts ?? 0) + 1 };
    finalMediaIds = rebuiltIds;
    qaRecomposed = true;
  }

  // keep using finalMediaIds below; replace first assignment
  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week, "carousel");
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, format, pillar_id, is_auto, platform, status, scheduled_at, style_meta)
     values ($1, $2, $3::uuid[], 'carousel', $4, false, 'instagram', 'pending_approval', $5, $6::jsonb)
     returning *`,
    [
      brand.id,
      humanizeCaption(caption),
      finalMediaIds,
      pillar.id,
      slot.toISOString(),
      JSON.stringify({
        generated: true,
        wants_text: true,
        photo_carousel: true,
        researched_ideas: ideaMode,
        slides: finalMediaIds.length,
        topic_hint: topic || null,
        faceless: isFacelessBrand(brand),
        qa_recomposed: qaRecomposed,
      }),
    ],
  );
  if (!post) return null;
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({
        caption,
        format: "carousel",
        slides: finalMediaIds.length,
        photo: true,
        researched_ideas: ideaMode,
        qa_recomposed: qaRecomposed,
      }),
      ideaMode ? "AI photo+text carousel (researched ideas)" : "AI photo+text carousel",
    ],
  ).catch(() => {});
  const mediaUrls = (
    await Promise.all(finalMediaIds.map((id) => previewUrlForPost(brand, post, id)))
  ).filter((u): u is string => Boolean(u));
  return {
    ok: true,
    post,
    mediaUrl: mediaUrls[0] ?? (await previewUrlForPost(brand, post, post.media_ids[0]!)),
    mediaUrls,
  };
}

/** Tip carousel — thin wrapper over typed generator. Always pending_approval. */
export async function generateTipCarousel(
  brand: Brand,
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string } | null> {
  const res = await generateTypedCarousel(brand, pillar, "tip");
  if (!res || res.ok === false) return null;
  return { post: res.post, mediaUrl: res.mediaUrl };
}

/** Draft a carousel from library photos — consistent shared grade across slides. */
export async function draftCarouselFromPhotos(
  brand: Brand,
  photoIds: string[],
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string | null } | null> {
  if (photoIds.length < 2) return null;
  const [captionResult, mediaIds] = await Promise.all([
    draftCaption(brand.id, photoIds),
    gradePhotoBundle(brand, photoIds),
  ]);
  const caption = captionResult.caption;
  // Generated/bot-assembled value still respects autopilot for *photo* bundles,
  // but tip/typed generators above always force pending_approval.
  const autopilot = Boolean(pillar.autopilot);
  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week, 'carousel');
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], 'carousel', $5, $6, $7, 'instagram', $8, $9)
     returning *`,
    [
      brand.id,
      caption,
      mediaIds,
      photoIds,
      pillar.id,
      autopilot,
      autopilot ? new Date().toISOString() : null,
      autopilot ? "scheduled" : "pending_approval",
      slot.toISOString(),
    ],
  );
  if (!post) return null;
  if (autopilot) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'approved', 'system-autopilot', $3)`,
      [post.id, brand.id, "Auto-scheduled carousel from library"],
    ).catch(() => {});
  }
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}

/**
 * Draft a STORY from one photo (Phase C4).
 * Uses short overlay path (not feed caption). 9:16 creative + optional CTA.
 * Candid auto-posts; salesy waits for yes.
 */
export async function draftStoryFromPhoto(
  brand: Brand,
  photo: { id: string },
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string | null; auto: boolean } | null> {
  // Parallel: overlay copy + photo grade (C6).
  const [overlay, edited] = await Promise.all([
    draftStoryOverlay(brand, photo.id),
    editImageForBrand(brand, photo.id).catch(() => null),
  ]);
  const tone = await classifyStoryTone(brand, `${overlay.overlay} ${overlay.cta ?? ""}`);
  const auto = tone === "candid";

  // Destination link on Stories: Meta Graph cannot publish link stickers, so we
  // bake a "comment/DM for the link" CTA into the overlay and register link_offer
  // for private-reply fulfillment (same as feed comment_dm).
  let linkOffer: LinkOffer | null = null;
  const bookingUrl = resolveDestinationLink(brand);
  if (bookingUrl) {
    linkOffer = buildLinkOffer({ url: bookingUrl, platform: "instagram", format: "story" });
    if (!overlay.cta) overlay.cta = storyLinkCta(linkOffer);
  }

  let coverId = edited ?? photo.id;
  const creativeId = await applyStoryCreative(brand, coverId, overlay.overlay, overlay.cta);
  if (creativeId) coverId = creativeId;
  else {
    // Fallback: at least try a punchy tile headline if story creative fails.
    const hl = overlay.overlay || (await generateHeadline(brand, overlay.overlay));
    const { applyTextTile } = await import("./imaging.js");
    const tiled = await applyTextTile(brand, coverId, hl).catch(() => null);
    if (tiled) coverId = tiled;
  }

  // Store the short overlay as caption — intentional, not a discarded feed caption.
  const caption = [overlay.overlay, overlay.cta].filter(Boolean).join(" · ");
  const mediaIds = [coverId];
  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week, 'story');
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at, link_offer)
     values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'story', $6, $7, $8, 'instagram', $9, $10, $11::jsonb)
     returning *`,
    [
      brand.id,
      caption,
      mediaIds,
      [photo.id],
      JSON.stringify({
        story_overlay: overlay.overlay,
        story_cta: overlay.cta ?? null,
        wants_text: true,
        // Meta Content Publishing API cannot attach Story link stickers (polls/
        // location/link stickers unsupported). CTA is baked into creative + fulfilled via DM.
        story_link_sticker: false,
        story_link_sticker_note:
          "API cannot publish link stickers; owner may add one manually in IG if desired.",
      }),
      pillar.id,
      auto,
      auto ? new Date().toISOString() : null,
      auto ? "scheduled" : "pending_approval",
      slot.toISOString(),
      linkOffer ? JSON.stringify(linkOffer) : null,
    ],
  );
  if (!post) return null;
  if (auto) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'approved', 'system-autopilot', $3)`,
      [post.id, brand.id, "Auto-posted candid story"],
    ).catch(() => {});
  }
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!), auto };
}

/** Turn the parked photos into SEPARATE feed posts; drop the holding draft. */
export async function resolveAsSeparate(brand: Brand, draft: Post): Promise<number> {
  const ids = draft.source_media_ids ?? draft.media_ids;
  const pillars = await ensurePillars(brand.id);
  // Parallel draft of separate posts with a concurrency ceiling.
  const outcomes = await mapWithConcurrency(ids, SLIDE_RENDER_CONCURRENCY, async (id) => {
    try {
      const [{ caption }, edited, pillar] = await Promise.all([
        draftCaption(brand.id, [id]),
        editImageForBrand(brand, id).catch(() => null),
        classifyPhotoPillar(brand, pillars, id),
      ]);
      const finalId = edited ?? id;
      const autopilot = Boolean(pillar?.autopilot);
      const slot = await scheduleFor(brand, pillar?.id ?? null, pillar?.posts_per_week ?? 0, 'feed');
      await query(
        `insert into posts (brand_id, caption, media_ids, source_media_ids, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
         values ($1, $2, $3::uuid[], $4::uuid[], 'feed', $5, $6, $7, 'instagram', $8, $9)`,
        [
          brand.id,
          caption,
          [finalId],
          [id],
          pillar?.id ?? null,
          autopilot,
          autopilot ? new Date().toISOString() : null,
          autopilot ? "scheduled" : "pending_approval",
          slot.toISOString(),
        ],
      );
      return 1;
    } catch (err) {
      console.error(`resolveAsSeparate: failed for media ${id}`, err);
      return 0;
    }
  });
  await query("delete from posts where id = $1", [draft.id]).catch(() => {});
  return outcomes.reduce((a: number, b: number) => a + b, 0);
}
