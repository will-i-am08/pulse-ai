import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, brandVoiceProfileSchema, type Brand, type Pillar } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { renderQuoteCard, generatePhotoImage } from "./imaging.js";
import { visualReference } from "./library.js";
import { ensurePillars } from "./pillars.js";
import { scheduleSlot } from "./scheduler.js";

// Content atomisation: take one existing asset (a website page, blog post, menu)
// and turn it into a batch of on-brand posts spread across the calendar.

type PlanItem = {
  caption: string;
  pillar_key?: string;
  visual: "card" | "photo";
  card?: string;
  photo_prompt?: string;
};

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true; // loopback / private / link-local (incl. cloud metadata)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isBlockedHost(u.hostname)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(withProto, { headers: { "User-Agent": "PulseBot/1.0" }, signal: ctrl.signal }).finally(() =>
      clearTimeout(timer),
    );
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 1_000_000); // cap the download
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return null;
  }
}

/**
 * Repurpose a URL (website / blog / menu) into a batch of scheduled draft posts.
 * Returns a summary, or null if the page couldn't be read.
 */
export async function repurposeUrl(brand: Brand, url: string): Promise<string | null> {
  const text = await fetchPage(url);
  if (!text || text.length < 120) return null;

  const pillars = await ensurePillars(brand.id);
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const pillarList = pillars.map((p) => `${p.key} (${p.name})`).join(", ");
  const system = [
    `You turn a page of the client's own content into a batch of 4-6 social posts for "${brand.name}".`,
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    `Available pillars: ${pillarList}.`,
    'Output ONLY JSON: {"posts":[{"caption":"","pillar_key":"","visual":"card|photo","card":"<punchy line if visual=card>","photo_prompt":"<image description if visual=photo>"}]}',
    "Each post must stand on its own and be specific to the content. Vary the pillars. Use visual=card for quotes/tips/offers and visual=photo when a described scene fits.",
  ]
    .filter(Boolean)
    .join("\n");

  let items: PlanItem[];
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: text }], maxTokens: 1400 });
    items = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).posts ?? [])
      .filter((i: PlanItem) => i && i.caption)
      .slice(0, 6); // cap generated images per call — never a runaway

  } catch (err) {
    console.error("repurposeUrl: LLM/parse failed", err);
    return null;
  }
  if (items.length === 0) return null;

  // Does the brand have real photos on file? If so, ground AI generation in their look.
  const hasRealPhotos = Boolean(
    await queryOne(`select 1 from media_assets where brand_id = $1 and source = 'client' and kind = 'photo' limit 1`, [brand.id]),
  );

  let created = 0;
  for (const item of items) {
    const pillar: Pillar | undefined = pillars.find((p) => p.key === item.pillar_key) ?? pillars[0];
    const mediaId = randomUUID();
    try {
      const ref = visualReference(brand, hasRealPhotos);
      const img =
        item.visual === "photo" && item.photo_prompt
          ? await generatePhotoImage(ref ? `${item.photo_prompt}. ${ref}` : item.photo_prompt)
          : await renderQuoteCard(item.card ?? item.caption.slice(0, 60), brand.name);
      if (!img) continue;
      await query(
        `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
         values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
        [mediaId, brand.id, mediaId],
      );
      await putMedia(mediaId, new Uint8Array(img), "image/jpeg");
    } catch (err) {
      console.error("repurposeUrl: media failed", err);
      continue;
    }
    const slot = await scheduleSlot({
      brandId: brand.id,
      platform: "instagram",
      pillarId: pillar?.id ?? null,
      postsPerWeek: pillar?.posts_per_week ?? 0,
    });
    const post = await queryOne<{ id: string }>(
      `insert into posts (brand_id, caption, media_ids, pillar_id, is_auto, style_meta, platform, status, scheduled_at)
       values ($1, $2, $3::uuid[], $4, false, '{}'::jsonb, 'instagram', 'pending_approval', $5) returning id`,
      [brand.id, item.caption, [mediaId], pillar?.id ?? null, slot.toISOString()],
    );
    if (!post) continue;
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, after, note)
       values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
      [post.id, brand.id, JSON.stringify({ repurposed_from: url }), "Repurposed from URL"],
    );
    created++;
  }
  if (created === 0) return null;
  return `Turned that page into ${created} draft posts. They're spread across your pillars and on the calendar. Open the calendar to review and approve them.`;
}
