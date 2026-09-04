import { randomUUID } from "node:crypto";
import {
  query,
  queryOne,
  putMedia,
  brandVoiceProfileSchema,
  type Brand,
  type Campaign,
  type CampaignPlanItem,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { renderQuoteCard } from "./imaging.js";

const WINDOW_HOURS = [11, 13, 19]; // spread campaign posts across the day

/** The most-recent campaign still awaiting go-ahead — only if proposed recently,
 * so a forgotten proposal can't hijack a later "yes". */
export async function getProposedCampaign(brandId: string): Promise<Campaign | null> {
  return queryOne<Campaign>(
    `select * from campaigns
      where brand_id = $1 and status = 'proposed' and created_at > now() - interval '20 minutes'
      order by created_at desc limit 1`,
    [brandId],
  );
}

/** True if a pillar-pausing campaign is live right now (gap-fill checks this). */
export async function hasActivePausingCampaign(brandId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from campaigns
      where brand_id = $1 and status = 'active' and pause_pillars = true
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at >= now())
      limit 1`,
    [brandId],
  );
  return Boolean(row);
}

/**
 * Turn a client's request ("2-week launch for my new blend") into a proposed
 * campaign plan and store it as status 'proposed'. Returns a summary to show the
 * client for approval, or null if the request isn't really a campaign.
 */
export async function proposeCampaign(
  brand: Brand,
  request: string,
): Promise<{ campaign: Campaign; summary: string } | null> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const system = [
    `You plan a short social-media campaign for "${brand.name}".`,
    profile.tone.length ? `Brand tone: ${profile.tone.join(", ")}.` : "",
    "From the client's request, design a coherent campaign with a clear arc (tease → build → launch/offer → last call).",
    'Output ONLY JSON: {"name":"<short campaign name>","goal":"<one line>","duration_days":<int 5-21>,"items":[{"day":<int from 0>,"angle":"<the angle of this post>","caption":"<full caption>","card":"<punchy 4-12 word line for a text card>"}]}',
    "Use 4-8 items spread across the duration. Keep captions on-brand and specific to the request.",
  ]
    .filter(Boolean)
    .join("\n");

  let plan: { name: string; goal?: string; duration_days?: number; items?: CampaignPlanItem[] };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: request }], maxTokens: 1200 });
    plan = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch (err) {
    console.error("proposeCampaign: LLM/parse failed", err);
    return null;
  }
  const items = (plan.items ?? []).filter((i) => i && typeof i.day === "number" && i.caption && i.card);
  if (items.length === 0) return null;

  const duration = Math.max(3, Math.min(28, plan.duration_days ?? 14));
  const campaign = await queryOne<Campaign>(
    `insert into campaigns (brand_id, name, goal, status, plan, starts_at, ends_at)
     values ($1, $2, $3, 'proposed', $4::jsonb, now(), now() + ($5 || ' days')::interval)
     returning *`,
    [brand.id, plan.name ?? "Campaign", plan.goal ?? null, JSON.stringify(items), String(duration)],
  );
  if (!campaign) return null;

  const lines = items
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((i) => `• Day ${i.day + 1}: ${i.angle}`)
    .join("\n");
  const summary =
    `Here's a ${duration}-day campaign — "${campaign.name}"` +
    (plan.goal ? ` (${plan.goal})` : "") +
    `:\n\n${lines}\n\n${items.length} posts. Reply "yes" to run it — and tell me whether to **pause** your everyday posts during it or **blend** them in.`;
  return { campaign, summary };
}

/**
 * Approve a proposed campaign: generate each post (branded card), schedule it
 * across the window, and mark the campaign active. Returns a confirmation.
 */
export async function activateCampaign(
  brand: Brand,
  campaign: Campaign,
  pausePillars: boolean,
): Promise<string> {
  const start = campaign.starts_at ? new Date(campaign.starts_at) : new Date();
  const items = [...campaign.plan].sort((a, b) => a.day - b.day);
  let created = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    const when = new Date(start);
    when.setDate(when.getDate() + Math.max(0, item.day));
    when.setHours(WINDOW_HOURS[idx % WINDOW_HOURS.length]!, 0, 0, 0);
    if (when.getTime() < Date.now() + 30 * 60_000) when.setTime(Date.now() + 60 * 60_000);

    const mediaId = randomUUID();
    try {
      const img = await renderQuoteCard(item.card, brand.name);
      await query(
        `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
         values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
        [mediaId, brand.id, mediaId],
      );
      await putMedia(mediaId, new Uint8Array(img), "image/jpeg");
    } catch (err) {
      console.error("activateCampaign: render/store failed", err);
      continue;
    }

    const post = await queryOne<{ id: string }>(
      `insert into posts (brand_id, caption, media_ids, campaign_id, is_auto, style_meta, platform, status, scheduled_at)
       values ($1, $2, $3::uuid[], $4, false, '{}'::jsonb, 'instagram', 'scheduled', $5)
       returning id`,
      [brand.id, item.caption, [mediaId], campaign.id, when.toISOString()],
    );
    if (!post) continue;
    // Plan-approval covers the campaign posts — record a system approval so the
    // publish gate passes without per-post sign-off.
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note)
       values ($1, $2, 'approved', 'system-campaign', $3)`,
      [post.id, brand.id, `Campaign "${campaign.name}" post`],
    );
    created++;
  }

  if (created === 0) {
    // Every render failed — don't flip a hollow campaign to active.
    return "I couldn't build the campaign posts just then — mind trying that again?";
  }

  await query(`update campaigns set status = 'active', pause_pillars = $1 where id = $2`, [pausePillars, campaign.id]);

  const endStr = campaign.ends_at
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(campaign.ends_at))
    : "";
  return (
    `🚀 "${campaign.name}" is live — ${created} posts scheduled${endStr ? ` through ${endStr}` : ""}. ` +
    (pausePillars ? "Your everyday posts are paused for the run." : "Your everyday posts keep running alongside it.") +
    " See it all on your calendar."
  );
}
