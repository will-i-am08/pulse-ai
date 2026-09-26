import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, brandVoiceProfileSchema, type Brand, type Pillar, type Post } from "@pulse/shared";
import { callLLM } from "./llm.js";
import {
  renderQuoteCard,
  generatePhotoImage,
  generateHeadline,
  applyTextTile,
  formatOverlayHeadline,
  formatExactOverlayHeadline,
  stampBrandLogo,
} from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { brandContextForPrompt } from "./brandContext.js";
import { visualReference } from "./library.js";
import { resolveVisualMode, type VisualMode } from "./visualMode.js";
import { inferContentJob, formatBiasForJob, isLinkedInPrimary } from "./contentJobs.js";
import { hooksPromptBlock } from "./hooks.js";
import { humanizeCaption, captionJobForFormat, captionJobPrompt } from "./humanizeCaption.js";
import { facelessPromptLine, facelessPhotoConstraint, stripPersonalNames, creativeBrandLabel, creativeSceneConstraint, overlayMasthead } from "./faceless.js";
import { captureInterviewVisualTokens } from "./onboarding.js";
import { NEVER_INVENT_PROOF } from "./persona.js";
import {
  looksLikeCityscapeBrief,
  looksLikeComparisonBrief,
  reinforceTopicHint,
  reviewBriefCompliance,
} from "./briefCompliance.js";
import { extractPlatforms, linkedInCaptionPromptBlock, buildPlatformCaptions } from "./destinations.js";
import { FEED_PHOTO_LOOK_INSTRUCTION, FEED_PHOTO_REALISM_CUE } from "./ugc/presets/stillPresets.js";
import {
  FEED_OVERLAY_INSTRUCTION,
  brandOverlayTreatment,
  overlayExplicitlyOff,
  resolveFeedOverlayIntent,
} from "./overlayIntent.js";
import {
  FEED_ELEMENTS_INSTRUCTION,
  constructedWantsPhoto,
  resolveBrandDecoKit,
  resolveFeedDecoIntent,
  resolveFeedElementsIntent,
  decoNeedsIdentity,
} from "./brandElements.js";

/**
 * Generate a filler post for a pillar (used when a slot is starving and the
 * client asks the agent to draft one). Always lands as pending_approval —
 * agent-generated content never auto-posts. Photo mode may burn a headline
 * onto the still when the agent asked for overlay (models stay text-free).
 * Construction (mark / constructed) is agent-chosen. Kit is identity (logo /
 * wordmark) optional per still — default photos stay clean. Constructed
 * generates a photo for type unless the brief is graphics-only.
 */
export async function generateFillerPost(
  brand: Brand,
  pillar: Pillar,
  opts?: {
    visuals?: VisualMode;
    topicHint?: string | null;
    destinations?: string[] | null;
    overlay?: unknown;
    overlay_tone?: unknown;
    overlay_headline?: unknown;
    elements?: unknown;
    deco?: unknown;
  },
): Promise<{ post: Post; mediaUrl: string } | null> {
  const topic = (opts?.topicHint ?? "").trim().slice(0, 400);
  const overlayIntent = resolveFeedOverlayIntent({
    brief: topic,
    overlay: opts?.overlay,
    overlay_tone: opts?.overlay_tone,
    overlay_headline: opts?.overlay_headline,
  });
  const elementsIntent = resolveFeedElementsIntent({
    brief: topic,
    elements: opts?.elements,
    name: overlayMasthead(brand),
  });
  const decoPieces = resolveFeedDecoIntent({
    brief: topic,
    deco: opts?.deco,
    visual: brand.visual,
  });
  if (
    (elementsIntent === "mark" || elementsIntent === "constructed" || decoNeedsIdentity(decoPieces)) &&
    !overlayMasthead(brand)
  ) {
    brand = (await captureInterviewVisualTokens(brand)).brand;
  }
  const wantOverlay =
    overlayIntent.mode === "headline" ||
    (elementsIntent === "constructed" &&
      !overlayExplicitlyOff({ brief: topic, overlay: opts?.overlay }));
  const exactOverlay = overlayIntent.exactHeadline;
  const visuals = opts?.visuals ?? resolveVisualMode(brand);
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const ctx = brandContextForPrompt(brand);
  const wantPhoto =
    elementsIntent === "constructed" ? constructedWantsPhoto(topic) : visuals === "photo";
  const job = inferContentJob({
    key: pillar.key,
    name: pillar.name,
    description: pillar.description,
    content_job: (pillar as { content_job?: string }).content_job,
  });
  // Prefer explicit kickoff destinations — agent briefs often drop "LinkedIn".
  const briefDests = [
    ...new Set([
      ...(opts?.destinations ?? []).map((d) => String(d).toLowerCase()),
      ...extractPlatforms(topic),
    ]),
  ];
  const linkedIn = isLinkedInPrimary(briefDests);
  const formatHint = formatBiasForJob(job, { destinations: briefDests });
  const captionJob = linkedIn ? "B" : captionJobForFormat(formatHint);
  const facelessLine = facelessPromptLine(brand);
  const noFace = facelessPhotoConstraint(brand);
  const trade = creativeBrandLabel(brand);
  const scene = creativeSceneConstraint(brand);
  const system = [
    linkedIn
      ? `You write a LinkedIn post for "${trade}" in the "${pillar.name}" content pillar (${pillar.description}).`
      : `You write a short social post for "${trade}" in the "${pillar.name}" content pillar (${pillar.description}).`,
    `Content job for this slot: ${job}. Preferred format bias: ${formatHint}.`,
    linkedIn ? linkedInCaptionPromptBlock() : captionJobPrompt(captionJob),
    linkedIn ? "" : hooksPromptBlock(job, 2),
    "Prefer a concrete angle from a real detail already on file (proof-bank number, named product, neighbourhood, the actual room or tool in the brief) — not a generic tip.",
    "If that proof bank is empty, write about the craft, the product, the room, or the neighbourhood. Never invent a regular, a testimonial, a made-up order, a specific job, a fault found today, or a this-week client win. Caption and overlay card must not claim an incident that is not in facts. Never ask the owner for more details. Never refuse. Output JSON only — no questions, no preamble.",
    topic ? `Owner brief (follow to the letter — every constraint matters): ${topic}` : "",
    exactOverlay
      ? `EXACT overlay headline required on the image (use this verbatim as "card", do not invent a shorter substitute): ${exactOverlay}`
      : "",
    looksLikeComparisonBrief(topic)
      ? "COMPARISON brief: caption + card must name at least TWO specific options and state a concrete difference (e.g. Cursor vs Claude Code). Category-level tips without named tools FAIL."
      : "",
    looksLikeCityscapeBrief(topic)
      ? "VISUAL brief: photo_prompt MUST be a cinematic cityscape / skyline background (urban dusk or night lights), not a desk, office, or abstract wash."
      : "",
    facelessLine ?? "",
    scene,
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    ctx || "",
    NEVER_INVENT_PROOF,
    FEED_ELEMENTS_INSTRUCTION,
    "No scarcity, book-now, filling-up-fast, or SALE energy unless the owner brief explicitly asks for a promo.",
    wantPhoto
      ? linkedIn
        ? wantOverlay
          ? 'Output ONLY JSON (no markdown): {"caption":"<2-4 short paragraphs of LinkedIn commentary, concrete stake first, ≤900 chars>","photo_prompt":"<one sentence: subject + place + lighting>","card":"<2-5 word overlay headline>"}'
          : 'Output ONLY JSON (no markdown): {"caption":"<2-4 short paragraphs of LinkedIn commentary, concrete stake first, ≤900 chars>","photo_prompt":"<one sentence: subject + place + lighting>","card":""}'
        : wantOverlay
          ? 'Output ONLY JSON (no markdown): {"caption":"<≤2 short sentences, ≤280 chars>","photo_prompt":"<one sentence: subject + place + lighting>","card":"<2-5 word overlay headline>"}'
          : 'Output ONLY JSON (no markdown): {"caption":"<≤2 short sentences, ≤280 chars>","photo_prompt":"<one sentence: subject + place + lighting>","card":""}'
      : linkedIn
        ? 'Output ONLY JSON (no markdown): {"caption":"<2-4 short paragraphs of LinkedIn commentary, concrete stake first, ≤900 chars>","card":"<4-12 word line for a text card>"}'
        : 'Output ONLY JSON (no markdown): {"caption":"<≤2 short sentences, ≤280 chars>","card":"<4-12 word line for a text card>"}',
    wantPhoto && wantOverlay
      ? "The card overlay must be a complete standalone headline, never a truncated sentence or sliced clause."
      : wantPhoto
        ? "Leave card empty — this still is a clean photo with no burned-in type."
        : "",
    wantPhoto
      ? [
          linkedIn ? "Caption can be fuller LinkedIn commentary — still keep JSON valid." : "Keep caption short — long captions get truncated and break JSON parsing.",
          "photo_prompt: one clear subject tied to the caption + place + lighting. Honour any background the owner named.",
          elementsIntent === "constructed"
            ? "The still is a photographed scene the headline and brand mark will sit on — not a blank graphic, not a poster, no type in the photo."
            : "",
          FEED_PHOTO_LOOK_INSTRUCTION,
          FEED_OVERLAY_INSTRUCTION,
          noFace || "People in frame are fine when the brief calls for them; otherwise prefer a clear subject.",
          "Do NOT invent random desk clutter (water bottles, laptops, phones, coffee cups, packaging) unless the post is literally about that object.",
          "No text, logos, watermarks, UI, posters, or graphics in the photo — type is burned on afterward from card.",
        ]
          .filter(Boolean)
          .join(" ")
      : "The card line must be short enough to read at a glance. No quotes around it, no emoji in the card.",
  ]
    .filter(Boolean)
    .join("\n");

  let caption = "";
  let card = "";
  let photoPrompt = "";
  try {
    let briefForDraft = topic;
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
      const drafted = await draftFillerFields(
        attemptSystem,
        briefForDraft ? `Brief: ${briefForDraft}` : pillar.name,
        wantPhoto,
      );
      if (!drafted) {
        if (attempt === 0) continue;
        return null;
      }
      caption = stripPersonalNames(drafted.caption, brand);
      card = exactOverlay
        ? formatExactOverlayHeadline(exactOverlay)
        : wantPhoto && wantOverlay
          ? formatOverlayHeadline(stripPersonalNames(drafted.card, brand))
          : wantPhoto
            ? ""
            : stripPersonalNames(drafted.card, brand);
      photoPrompt = drafted.photoPrompt;
      if (!topic) break;
      const compliance = await reviewBriefCompliance({
        brief: topic,
        caption,
        overlays: card ? [card] : [],
        photoPrompts: photoPrompt ? [photoPrompt] : [],
        surface: "feed",
      });
      if (compliance.pass) break;
      console.warn("generateFillerPost: brief compliance fail", compliance.reasons);
      if (attempt === 0) {
        briefForDraft = reinforceTopicHint(topic, compliance.reinforceHint);
        continue;
      }
      // Second miss — don't ship a draft that ignores the owner brief.
      return null;
    }
  } catch (err) {
    console.error("generateFillerPost: LLM/parse failed", err);
    return null;
  }

  if (!caption.trim()) return null;


  let mediaId: string = randomUUID();
  const sourceMediaId = mediaId;
  let photoHeadline: string | undefined;
  try {
    let img: Buffer | null = null;
    if (wantPhoto && photoPrompt) {
      const ref = visualReference(brand, false);
      const prompt = [photoPrompt, FEED_PHOTO_REALISM_CUE, noFace, scene, ref].filter(Boolean).join(". ");
      // Pass the brand so this counts against AI_WEEKLY_SPEND_CAP_USD — fillers
      // generate one paid image per draft, which was previously uncapped.
      img = await generatePhotoImage(prompt, "1:1", { brand });
    }
    if (!img) {
      // Photo mode must never silently ship a text card — that is how
      // "add pictures to the background" turned into the same plain cards.
      if (wantPhoto) {
        console.error("generateFillerPost: photo generation failed; refusing quote-card fallback");
        return null;
      }
      if (!card) return null;
      img = await renderQuoteCard(card, brand);
    }
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [mediaId, brand.id, mediaId],
    );
    await putMedia(mediaId, new Uint8Array(img), "image/jpeg");

    const wantMark =
      elementsIntent === "mark" || elementsIntent === "constructed" || decoNeedsIdentity(decoPieces);
    // Burn headline only when the agent asked for overlay (models stay text-free).
    // Keep the clean source id so set_image_text(false) can restore it.
    if (wantPhoto && wantOverlay) {
      photoHeadline =
        (exactOverlay && formatExactOverlayHeadline(exactOverlay)) ||
        (card && card.replace(/["']/g, "").trim()) ||
        (await generateHeadline(brand, caption));
      const overlayTreatment = brandOverlayTreatment(brand.visual, overlayIntent.tone);
      const tileOpts = {
        ...(topic ? { ask: topic } : {}),
        ...(exactOverlay ? { exact: true } : {}),
        treatment: overlayTreatment,
      };
      const tiledId = await applyTextTile(brand, mediaId, photoHeadline, tileOpts);
      if (tiledId) mediaId = tiledId;
    }
    if (wantMark || decoPieces.length) {
      // Quote cards already paint the wordmark via overlayMasthead; still stamp a logo file.
      if (wantPhoto || brand.visual?.logo_url || decoPieces.length) {
        const stampedId = await stampBrandLogo(brand, mediaId, {
          elements: elementsIntent,
          deco: decoPieces,
        });
        if (stampedId) mediaId = stampedId;
      }
    }
  } catch (err) {
    console.error("generateFillerPost: render/store failed", err);
    return null;
  }

  const slot = await scheduleSlot({
    brandId: brand.id,
    platform: linkedIn ? "linkedin" : "instagram",
    pillarId: pillar.id,
    postsPerWeek: pillar.posts_per_week,
    format: formatHint === "story" ? "feed" : formatHint === "reel" ? "reel" : formatHint === "carousel" ? "carousel" : "feed",
  });
  caption = humanizeCaption(caption);
  const dests = linkedIn ? briefDests.length ? briefDests : ["linkedin"] : [];
  const captions = dests.length ? buildPlatformCaptions(caption) : null;
  const styleMeta = {
    content_job: job,
    format_bias: formatHint,
    generated: true,
    ...(linkedIn ? { linkedin_primary: true } : {}),
    ...(wantPhoto && wantOverlay
      ? { wants_text: true, ...(photoHeadline ? { headline: photoHeadline } : {}) }
      : wantPhoto
        ? { wants_text: false }
        : {}),
    ...(elementsIntent !== "none" ? { brand_elements: elementsIntent } : {}),
    ...(decoPieces.length ? { brand_kit: resolveBrandDecoKit(brand.visual, decoPieces) } : {}),
    ...(wantPhoto && wantOverlay
      ? { overlay_type: brandOverlayTreatment(brand.visual, overlayIntent.tone) }
      : {}),
  };
  const sourceMediaIds = wantPhoto ? [sourceMediaId] : [];
  const post = await queryOne<Post>(
    linkedIn
      ? `insert into posts (brand_id, caption, media_ids, source_media_ids, pillar_id, is_auto, style_meta, platform, status, scheduled_at, destinations, captions, format)
         values ($1, $2, $3::uuid[], $4::uuid[], $5, false, $7::jsonb, $8, 'pending_approval', $6, $9::text[], $10::jsonb, $11)
         returning *`
      : `insert into posts (brand_id, caption, media_ids, source_media_ids, pillar_id, is_auto, style_meta, platform, status, scheduled_at)
         values ($1, $2, $3::uuid[], $4::uuid[], $5, false, $7::jsonb, 'instagram', 'pending_approval', $6)
         returning *`,
    linkedIn
      ? [
          brand.id,
          caption,
          [mediaId],
          sourceMediaIds,
          pillar.id,
          slot.toISOString(),
          JSON.stringify(styleMeta),
          "linkedin",
          dests,
          JSON.stringify(captions),
          formatHint === "carousel" ? "carousel" : "feed",
        ]
      : [
          brand.id,
          caption,
          [mediaId],
          sourceMediaIds,
          pillar.id,
          slot.toISOString(),
          JSON.stringify(styleMeta),
        ],
  );
  if (!post) return null;

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [post.id, brand.id, JSON.stringify({ caption, pillar: pillar.key, generated: true, visuals, photo: wantPhoto }), wantPhoto ? "Generated photo feed post" : "Generated filler post"],
  );

  // The quote card IS the visual — frame it in the IG mockup for the preview.
  // The mockup id stays out of posts.media_ids; publishing still sends the card.
  return { post, mediaUrl: await previewUrlForPost(brand, post, mediaId) };
}


/** Pull the first JSON object from an LLM reply (fences OK). */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

type FillerFields = { caption: string; card: string; photoPrompt: string };

/**
 * Ask the LLM for filler JSON. Retries once on empty/truncated/invalid JSON —
 * photo drafts were failing live with "Unexpected end of JSON input" when
 * maxTokens clipped mid-object.
 */
export async function draftFillerFields(
  system: string,
  pillarName: string,
  wantPhoto: boolean,
): Promise<FillerFields | null> {
  const maxTokens = wantPhoto ? 700 : 500;
  let lastRaw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callLLM({
      system:
        attempt === 0
          ? system
          : `${system}\nRETRY: previous reply was not valid JSON. Output ONLY the JSON object. Do not ask questions.`,
      messages: [{ role: "user", content: `Write today's ${pillarName} post.` }],
      maxTokens,
    });
    lastRaw = raw ?? "";
    const json = extractJsonObject(lastRaw);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const caption = String(parsed.caption ?? "").trim();
      const card = String(parsed.card ?? "").trim();
      const photoPrompt = String(parsed.photo_prompt ?? "").trim();
      if (!caption) continue;
      if (!wantPhoto && !card) continue;
      if (wantPhoto && !photoPrompt && !card) continue;
      return { caption, card, photoPrompt };
    } catch {
      // retry
    }
  }
  console.error(
    "generateFillerPost: LLM JSON unusable after retries",
    lastRaw.slice(0, 240),
  );
  return null;
}

/** The pillar most recently nudged about a gap (within 48h), for "draft one". */
export async function recentlyPingedPillar(brandId: string): Promise<Pillar | null> {
  return queryOne<Pillar>(
    `select * from pillars
      where brand_id = $1 and last_gap_ping_at is not null
        and last_gap_ping_at > now() - interval '48 hours'
      order by last_gap_ping_at desc
      limit 1`,
    [brandId],
  );
}
