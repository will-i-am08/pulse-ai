import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, brandVoiceProfileSchema, type Brand, type Pillar, type Post } from "@pulse/shared";
import { callLLM } from "./llm.js";
import {
  renderQuoteCard,
  generatePhotoImage,
  generateHeadline,
  applyTextTile,
} from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { brandContextForPrompt } from "./brandContext.js";
import { visualReference } from "./library.js";
import { resolveVisualMode, type VisualMode } from "./visualMode.js";
import { inferContentJob, formatBiasForJob } from "./contentJobs.js";
import { hooksPromptBlock } from "./hooks.js";
import { humanizeCaption, captionJobForFormat, captionJobPrompt } from "./humanizeCaption.js";
import { facelessPromptLine, facelessPhotoConstraint, stripPersonalNames } from "./faceless.js";

/**
 * Generate a filler post for a pillar (used when a slot is starving and the
 * client asks the agent to draft one). Always lands as pending_approval —
 * agent-generated content never auto-posts. Photo mode burns a headline onto
 * the generated still (models stay text-free; overlay is applied after).
 */
export async function generateFillerPost(
  brand: Brand,
  pillar: Pillar,
  opts?: { visuals?: VisualMode; topicHint?: string | null },
): Promise<{ post: Post; mediaUrl: string } | null> {
  const visuals = opts?.visuals ?? resolveVisualMode(brand);
  const topic = (opts?.topicHint ?? "").trim().slice(0, 400);
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const ctx = brandContextForPrompt(brand);
  const wantPhoto = visuals === "photo";
  const job = inferContentJob({
    key: pillar.key,
    name: pillar.name,
    description: pillar.description,
    content_job: (pillar as { content_job?: string }).content_job,
  });
  const formatHint = formatBiasForJob(job);
  const captionJob = captionJobForFormat(formatHint);
  const facelessLine = facelessPromptLine(brand);
  const noFace = facelessPhotoConstraint(brand);
  const system = [
    `You write a short social post for "${brand.name}" in the "${pillar.name}" content pillar (${pillar.description}).`,
    `Content job for this slot: ${job}. Preferred format bias: ${formatHint}.`,
    captionJobPrompt(captionJob),
    hooksPromptBlock(job, 2),
    "Require a concrete angle from a real detail (client win, number in proof bank, mistake, or this-week moment) — not a generic tip.",
    topic ? `Owner brief (honour the subject matter): ${topic}` : "",
    facelessLine ?? "",
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    ctx || "",
    "Never invent discounts, awards, or testimonials not in offers/facts. Only use numbers from the proof bank / facts.",
    wantPhoto
      ? 'Output ONLY JSON (no markdown): {"caption":"<≤2 short sentences, ≤280 chars>","photo_prompt":"<one sentence: subject + place + lighting>","card":"<4-12 word overlay headline>"}'
      : 'Output ONLY JSON (no markdown): {"caption":"<≤2 short sentences, ≤280 chars>","card":"<4-12 word line for a text card>"}',
    wantPhoto
      ? [
          "Keep caption short — long captions get truncated and break JSON parsing.",
          "photo_prompt: real handheld/stock look, natural window or outdoor light, one clear subject tied to the caption.",
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

  let caption: string;
  let card: string;
  let photoPrompt = "";
  try {
    const drafted = await draftFillerFields(
      system,
      topic ? `Brief: ${topic}` : pillar.name,
      wantPhoto,
    );
    if (!drafted) return null;
    caption = stripPersonalNames(drafted.caption, brand);
    card = stripPersonalNames(drafted.card, brand);
    photoPrompt = drafted.photoPrompt;
  } catch (err) {
    console.error("generateFillerPost: LLM/parse failed", err);
    return null;
  }

  let mediaId: string = randomUUID();
  let photoHeadline: string | undefined;
  try {
    let img: Buffer | null = null;
    if (wantPhoto && photoPrompt) {
      const ref = visualReference(brand, false);
      const stockCue =
        "Authentic royalty-free stock photo, natural lighting, shallow depth of field, no text, no logos, no watermark, no UI, no random props unrelated to the subject.";
      const prompt = [photoPrompt, stockCue, noFace, ref].filter(Boolean).join(". ");
      img = await generatePhotoImage(prompt);
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

    // Burn headline onto generated photos (models stay text-free).
    if (wantPhoto) {
      photoHeadline =
        (card && card.replace(/["']/g, "").trim()) ||
        (await generateHeadline(brand, caption));
      const tiledId = await applyTextTile(brand, mediaId, photoHeadline);
      if (tiledId) mediaId = tiledId;
    }
  } catch (err) {
    console.error("generateFillerPost: render/store failed", err);
    return null;
  }

  const slot = await scheduleSlot({
    brandId: brand.id,
    platform: "instagram",
    pillarId: pillar.id,
    postsPerWeek: pillar.posts_per_week,
    format: formatHint === "story" ? "feed" : formatHint === "reel" ? "reel" : formatHint === "carousel" ? "carousel" : "feed",
  });
  caption = humanizeCaption(caption);
  const styleMeta = {
    content_job: job,
    format_bias: formatHint,
    generated: true,
    ...(wantPhoto
      ? { wants_text: true, ...(photoHeadline ? { headline: photoHeadline } : {}) }
      : {}),
  };
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, pillar_id, is_auto, style_meta, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4, false, $6::jsonb, 'instagram', 'pending_approval', $5)
     returning *`,
    [brand.id, caption, [mediaId], pillar.id, slot.toISOString(), JSON.stringify(styleMeta)],
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
      system,
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
