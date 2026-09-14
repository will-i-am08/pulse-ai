import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, brandVoiceProfileSchema, type Brand, type Pillar, type Post } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { renderQuoteCard, generatePhotoImage } from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { brandContextForPrompt } from "./brandContext.js";
import { visualReference } from "./library.js";
import { resolveVisualMode, type VisualMode } from "./visualMode.js";
import { inferContentJob, formatBiasForJob } from "./contentJobs.js";
import { hooksPromptBlock } from "./hooks.js";
import { humanizeCaption, captionJobForFormat, captionJobPrompt } from "./humanizeCaption.js";

/**
 * Generate a text-only filler post for a pillar (used when a slot is starving and
 * the client asks the agent to draft one). Always lands as pending_approval —
 * agent-generated content never auto-posts.
 */
export async function generateFillerPost(
  brand: Brand,
  pillar: Pillar,
  opts?: { visuals?: VisualMode },
): Promise<{ post: Post; mediaUrl: string } | null> {
  const visuals = opts?.visuals ?? resolveVisualMode(brand);
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
  const system = [
    `You write a short social post for "${brand.name}" in the "${pillar.name}" content pillar (${pillar.description}).`,
    `Content job for this slot: ${job}. Preferred format bias: ${formatHint}.`,
    captionJobPrompt(captionJob),
    hooksPromptBlock(job, 2),
    "Require a concrete angle from a real detail (client win, number in proof bank, mistake, or this-week moment) — not a generic tip.",
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    ctx || "",
    "Never invent discounts, awards, or testimonials not in offers/facts. Only use numbers from the proof bank / facts.",
    wantPhoto
      ? 'Output ONLY JSON: {"caption":"<the full post caption, no hashtags unless natural>","photo_prompt":"<one vivid sentence describing a realistic photo that fits the post — lifestyle/product/scene, no text overlays, no logos, no watermarks>","card":"<optional 4-12 word fallback line if a photo cannot be generated>"}'
      : 'Output ONLY JSON: {"caption":"<the full post caption, no hashtags unless natural>","card":"<a punchy 4-12 word line to display big on a text card>"}',
    wantPhoto
      ? "Prefer a photographic scene. photo_prompt must describe a real-looking stock/AI photo, not a graphic or text card."
      : "The card line must be short enough to read at a glance. No quotes around it, no emoji in the card.",
  ]
    .filter(Boolean)
    .join("\n");

  let caption: string;
  let card: string;
  let photoPrompt = "";
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: `Write today's ${pillar.name} post.` }], maxTokens: 360 });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    caption = String(parsed.caption ?? "").trim();
    card = String(parsed.card ?? "").trim();
    photoPrompt = String(parsed.photo_prompt ?? "").trim();
    if (!caption) return null;
    if (!wantPhoto && !card) return null;
    if (wantPhoto && !photoPrompt && !card) return null;
  } catch (err) {
    console.error("generateFillerPost: LLM/parse failed", err);
    return null;
  }

  const mediaId = randomUUID();
  try {
    let img: Buffer | null = null;
    if (wantPhoto && photoPrompt) {
      const ref = visualReference(brand, false);
      const stockCue =
        "Authentic royalty-free stock photo look, natural lighting, no text, no logos, no watermark, no UI.";
      img = await generatePhotoImage(
        ref ? `${photoPrompt}. ${stockCue}. ${ref}` : `${photoPrompt}. ${stockCue}`,
      );
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
  const styleMeta = { content_job: job, format_bias: formatHint, generated: true };
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
