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
import { brandContextForPrompt } from "./brandContext.js";

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

/** Active or paused campaign for pause/resume/cancel verbs. */
export async function getLiveCampaign(brandId: string): Promise<Campaign | null> {
  return queryOne<Campaign>(
    `select * from campaigns
      where brand_id = $1 and status in ('active','paused')
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

export function looksLikeCampaignControl(body: string): "pause" | "resume" | "cancel" | null {
  if (/\b(pause|hold|freeze)\s+(the\s+|my\s+|our\s+)?campaign\b|\bcampaign\b.{0,20}\bpause\b/i.test(body)) {
    return "pause";
  }
  if (/\b(resume|unpause|restart|continue)\s+(the\s+|my\s+|our\s+)?campaign\b|\bcampaign\b.{0,20}\b(resume|unpause)\b/i.test(body)) {
    return "resume";
  }
  if (
    /\b(cancel|scrap|kill|stop)\s+(the\s+|my\s+|our\s+)?campaign\b|\bcampaign\b.{0,20}\b(cancel|scrap|kill)\b/i.test(
      body,
    )
  ) {
    return "cancel";
  }
  return null;
}

/**
 * Turn a client's request ("2-week launch for my new blend") into a proposed
 * campaign plan and store it as status 'proposed'. Uses ICP / pains / positioning /
 * offers when present — never invents discounts or awards. Returns a summary for
 * approval, or null if the request isn't really a campaign.
 */
export async function proposeCampaign(
  brand: Brand,
  request: string,
): Promise<{ campaign: Campaign; summary: string } | null> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const ctx = brandContextForPrompt(brand);
  const system = [
    `You plan a short organic social-media campaign for "${brand.name}".`,
    profile.tone.length ? `Brand tone: ${profile.tone.join(", ")}.` : "",
    ctx
      ? `Brand strategy (use this — ICP, pains, positioning, offers):\n${ctx}`
      : "No ICP/offers on file — stay general; do not invent a fake customer or discount.",
    "From the client's request, design a coherent campaign with a clear arc (tease → build → launch/offer → last call).",
    "Ground angles in positioning + confirmed pains when present. Offer posts must use the Offers object only — NEVER invent discounts, awards, or testimonials.",
    "Vary post jobs: tip/value, social proof framing (only with listed proof), offer/CTA, behind-the-scenes — not only generic quote cards.",
    'Output ONLY JSON: {"name":"<short campaign name>","goal":"<one line>","duration_days":<int 5-21>,"items":[{"day":<int from 0>,"angle":"<the angle of this post>","caption":"<full caption>","card":"<punchy 4-12 word line for a text card>","job":"tip|proof|offer|bts|tease"}]}',
    "Use 4-8 items spread across the duration. Keep captions on-brand and specific to the request + strategy.",
  ]
    .filter(Boolean)
    .join("\n");

  let plan: {
    name: string;
    goal?: string;
    duration_days?: number;
    items?: Array<CampaignPlanItem & { job?: string }>;
  };
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
  const strategyHint = ctx ? " Wired to your ICP/offers where relevant." : "";
  const summary =
    `Here's a ${duration}-day campaign: "${campaign.name}"` +
    (plan.goal ? ` (${plan.goal})` : "") +
    `.${strategyHint}\n\n${lines}\n\n${items.length} posts. Reply "yes" to run it, and tell me whether to pause your everyday posts during it or blend them in. I won't spend on ads.`;
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
      const img = await renderQuoteCard(item.card, brand);
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
    return "I couldn't build the campaign posts just then. Mind trying that again?";
  }

  await query(`update campaigns set status = 'active', pause_pillars = $1 where id = $2`, [pausePillars, campaign.id]);

  const endStr = campaign.ends_at
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(campaign.ends_at))
    : "";
  return (
    `🚀 "${campaign.name}" is live. ${created} posts scheduled${endStr ? ` through ${endStr}` : ""}. ` +
    (pausePillars ? "Your everyday posts are paused for the run." : "Your everyday posts keep running alongside it.") +
    " Say \"pause campaign\" / \"resume campaign\" / \"cancel campaign\" any time. See it all on your calendar."
  );
}

/** Reject not-yet-published campaign posts so they don't orphan on the calendar. */
async function cleanupCampaignPosts(campaignId: string, brandId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update posts set status = 'rejected', updated_at = now()
      where brand_id = $1 and campaign_id = $2
        and status in ('draft','pending_approval','approved','scheduled')
      returning id`,
    [brandId, campaignId],
  );
  return rows.length;
}

/** Hold future campaign posts (scheduled → draft) while paused. */
async function holdCampaignPosts(campaignId: string, brandId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update posts set status = 'draft', updated_at = now()
      where brand_id = $1 and campaign_id = $2 and status = 'scheduled'
      returning id`,
    [brandId, campaignId],
  );
  return rows.length;
}

/** Re-queue held campaign drafts that still have a future slot. */
async function releaseHeldCampaignPosts(campaignId: string, brandId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update posts set status = 'scheduled', updated_at = now()
      where brand_id = $1 and campaign_id = $2 and status = 'draft'
        and scheduled_at is not null and scheduled_at > now()
      returning id`,
    [brandId, campaignId],
  );
  return rows.length;
}

export async function pauseCampaign(brand: Brand, campaign?: Campaign | null): Promise<string> {
  const live = campaign ?? (await getLiveCampaign(brand.id));
  if (!live || live.status === "paused") {
    if (live?.status === "paused") return `"${live.name}" is already paused.`;
    return "No active campaign to pause.";
  }
  await query(`update campaigns set status = 'paused' where id = $1`, [live.id]);
  const held = await holdCampaignPosts(live.id, brand.id);
  return `Paused "${live.name}". Held ${held} scheduled post${held === 1 ? "" : "s"}. Say "resume campaign" to continue.`;
}

export async function resumeCampaign(brand: Brand, campaign?: Campaign | null): Promise<string> {
  const live = campaign ?? (await getLiveCampaign(brand.id));
  if (!live) return "No campaign to resume.";
  if (live.status === "active") return `"${live.name}" is already running.`;
  if (live.status !== "paused") return `Can't resume a ${live.status} campaign.`;
  await query(`update campaigns set status = 'active' where id = $1`, [live.id]);
  const released = await releaseHeldCampaignPosts(live.id, brand.id);
  return `Resumed "${live.name}". ${released} post${released === 1 ? "" : "s"} back on the calendar.`;
}

export async function cancelCampaign(brand: Brand, campaign?: Campaign | null): Promise<string> {
  const live =
    campaign ??
    (await getLiveCampaign(brand.id)) ??
    (await getProposedCampaign(brand.id));
  if (!live) return "No campaign to cancel.";
  await query(`update campaigns set status = 'cancelled' where id = $1`, [live.id]);
  const cleaned = await cleanupCampaignPosts(live.id, brand.id);
  return `Cancelled "${live.name}". Cleared ${cleaned} orphan scheduled/draft post${cleaned === 1 ? "" : "s"} — nothing else will go out from it.`;
}
