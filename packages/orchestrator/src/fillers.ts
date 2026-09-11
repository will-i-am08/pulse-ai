import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, brandVoiceProfileSchema, type Brand, type Pillar, type Post } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { renderQuoteCard } from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { brandContextForPrompt } from "./brandContext.js";

/**
 * Generate a text-only filler post for a pillar (used when a slot is starving and
 * the client asks the agent to draft one). Always lands as pending_approval —
 * agent-generated content never auto-posts.
 */
export async function generateFillerPost(
  brand: Brand,
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string } | null> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const ctx = brandContextForPrompt(brand);
  const system = [
    `You write a short social post for "${brand.name}" in the "${pillar.name}" content pillar (${pillar.description}).`,
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    ctx || "",
    "Never invent discounts, awards, or testimonials not in offers/facts.",
    "Output ONLY JSON: {\"caption\":\"<the full post caption, no hashtags unless natural>\",\"card\":\"<a punchy 4-12 word line to display big on a text card>\"}",
    "The card line must be short enough to read at a glance. No quotes around it, no emoji in the card.",
  ]
    .filter(Boolean)
    .join("\n");

  let caption: string;
  let card: string;
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: `Write today's ${pillar.name} post.` }], maxTokens: 300 });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    caption = String(parsed.caption ?? "").trim();
    card = String(parsed.card ?? "").trim();
    if (!caption || !card) return null;
  } catch (err) {
    console.error("generateFillerPost: LLM/parse failed", err);
    return null;
  }

  const mediaId = randomUUID();
  try {
    const img = await renderQuoteCard(card, brand);
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
    format: "feed",
  });
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, pillar_id, is_auto, style_meta, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4, false, '{}'::jsonb, 'instagram', 'pending_approval', $5)
     returning *`,
    [brand.id, caption, [mediaId], pillar.id, slot.toISOString()],
  );
  if (!post) return null;

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [post.id, brand.id, JSON.stringify({ caption, pillar: pillar.key, generated: true }), "Generated filler post"],
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
