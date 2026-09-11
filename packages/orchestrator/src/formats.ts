import {
  query,
  queryOne,
  brandVoiceProfileSchema,
  sanitizeChatText,
  type Brand,
  type Pillar,
  type Post,
  type PostFormat,
} from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import {
  editImageForBrand,
  gradePhotoBundle,
  applyStoryCreative,
  generateHeadline,
} from "./imaging.js";
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
import { ensureDesignQa, designQaFailureSms } from "./designQa.js";
import { routeImageJob } from "./modelRouter.js";

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
      const row = await queryOne<{ format_bias: PostFormat | null }>(
        `select format_bias from pillars where id = $1 and brand_id = $2`,
        [pillarId, brandId],
      );
      if (row?.format_bias && ["feed", "carousel", "story", "reel"].includes(row.format_bias)) {
        preferred = row.format_bias;
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
        '{"overlay":"<3-7 punchy words>","cta":"<optional short CTA or empty>"}',
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
    const overlay = sanitizeChatText(String(parsed.overlay ?? "")).slice(0, 48);
    const cta = sanitizeChatText(String(parsed.cta ?? "")).slice(0, 36);
    if (overlay) return { overlay, cta: cta || undefined };
  } catch (err) {
    console.error("draftStoryOverlay failed", err);
  }
  return { overlay: brand.name.slice(0, 24) };
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
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'story', $6, $7, $8, 'instagram', $9, $10)
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
      }),
      pillar.id,
      auto,
      auto ? new Date().toISOString() : null,
      auto ? "scheduled" : "pending_approval",
      slot.toISOString(),
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
