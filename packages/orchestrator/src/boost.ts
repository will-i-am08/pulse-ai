import { query, queryOne, type Brand, type AdCampaign, type AdAudience, type Post } from "@pulse/shared";
import { getMarketingAdapter } from "@pulse/graph";
import {
  adsEnabled, adsDisabledMessage, isAdsConnected, assertCanSpend, formatCents,
  logAdApproval, recordSpend, spendCaps,
} from "./adsFeatures.js";
import { connectLinkMessage } from "./smsConnect.js";

function defaultAudience(brand: Brand): AdAudience {
  const who = brand.icp?.segments?.[0] ?? brand.icp?.demographics ?? undefined;
  return {
    label: who ? `ICP: ${who.slice(0, 80)}` : "Broad + page engagers",
    meta_type: "interest", interests: who ? [who.slice(0, 60)] : ["local business"],
    age_min: 25, age_max: 55,
  };
}
function parseBudgetCents(body: string): number | null {
  const m = body.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
function parseDays(body: string): number {
  const m = body.match(/\b(\d+)\s*(?:day|days)\b/i);
  if (m) return Math.max(1, Math.min(30, Number(m[1])));
  if (/\bweek\b/i.test(body)) return 7;
  return 3;
}

/**
 * A PAID boost ask — it must point at an existing post ("boost this", "promote
 * that post"). A bare \b(boost|promote)\b hijacked ordinary organic requests
 * ("can you promote our new winter menu this week") into the ad-account OAuth
 * handoff and drafted nothing at all.
 */
const BOOST_OBJECT_RE =
  /\b(boost|promote)\s+(this|that|it|them|these|those)\b|\b(boost|promote)\s+(?:my\s+|our\s+|the\s+)?(?:top\s+|best\s+|winning\s+|latest\s+|last\s+|recent\s+|new\s+)*(post|posts|one|reel|reels|story|video)\b|\b(boost|promote)\s+post[_\s-]?id\b/i;

export function looksLikeBoostRequest(body: string): boolean {
  return BOOST_OBJECT_RE.test(body) || /\bput money behind\b/i.test(body)
    || /\bturn\s+(this|that)\s+into\s+(an?\s+)?(ad|boost|paid campaign)\b/i.test(body)
    || /\bcampaign\s+(this|that|the winner)\b/i.test(body);
}

export async function getProposedBoost(brandId: string): Promise<AdCampaign | null> {
  return queryOne<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and kind='boost' and status='proposed'
       and created_at > now() - interval '20 minutes' order by created_at desc limit 1`, [brandId],
  );
}

async function resolveSourcePost(brand: Brand, body: string): Promise<Post | null> {
  const byId = body.match(/\bpost[_\s-]?id[:\s]*([0-9a-f-]{36})\b/i);
  if (byId) return queryOne<Post>(`select * from posts where id=$1 and brand_id=$2`, [byId[1], brand.id]);
  return queryOne<Post>(
    `select * from posts where brand_id=$1 and status='published' order by published_at desc nulls last limit 1`,
    [brand.id],
  );
}

export async function proposeBoost(
  brand: Brand, request: string,
): Promise<{ ok: true; campaign: AdCampaign; summary: string } | { ok: false; summary: string }> {
  if (!adsEnabled(brand)) return { ok: false, summary: adsDisabledMessage() };
  if (!isAdsConnected(brand)) {
    return { ok: false, summary: "Connect an ad account first so I can boost without guessing.\n\n" + connectLinkMessage(brand, "ads") };
  }
  const post = await resolveSourcePost(brand, request);
  if (!post) {
    return { ok: false, summary: "I don't see a published post to boost yet. Publish one first, or tell me which post after it goes live." };
  }
  const caps = spendCaps(brand);
  let budget = parseBudgetCents(request) ?? Math.min(3_000, Math.floor(caps.campaign_cents / 4));
  if (budget < 500) {
    return { ok: false, summary: 'That budget\'s too small — try at least $5/day, e.g. "boost this for $15 over 3 days".' };
  }
  if (budget > caps.campaign_cents) budget = caps.campaign_cents;
  const days = parseDays(request);
  const audience = defaultAudience(brand);
  const campaign = await queryOne<AdCampaign>(
    `insert into ad_campaigns
      (brand_id, name, objective, status, audience, creative, budget_cents, duration_days,
       weekly_cap_cents, campaign_cap_cents, source_post_id, kind, plan)
     values ($1,$2,'traffic','proposed',$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,'boost','{}'::jsonb) returning *`,
    [brand.id, `Boost: ${(post.caption ?? "post").slice(0, 40)}`, JSON.stringify(audience),
     JSON.stringify({ source: "organic", primary_text: (post.caption ?? "").slice(0, 500), source_post_id: post.id, cta: brand.offers?.cta ?? "Learn more" }),
     budget, days, caps.weekly_cents, caps.campaign_cents, post.id],
  );
  if (!campaign) return { ok: false, summary: "Couldn't save that boost proposal — try again in a moment." };
  const summary =
    `🚀 Boost proposal\n\nPost: "${(post.caption ?? "your latest post").slice(0, 90)}${(post.caption?.length ?? 0) > 90 ? "…" : ""}"\n` +
    `Budget: ${formatCents(budget)}/day · ${days} day${days === 1 ? "" : "s"}\nAudience: ${audience.label}\n` +
    `Est. total: ~${formatCents(budget * days)}\n\nReply "yes" to run it, or tell me a different budget/audience/duration. "no" cancels.`;
  return { ok: true, campaign, summary };
}

export async function confirmBoost(brand: Brand, proposed: AdCampaign): Promise<string> {
  if (!adsEnabled(brand)) return adsDisabledMessage();
  if (!isAdsConnected(brand)) return connectLinkMessage(brand, "ads");
  const blocked = await assertCanSpend(brand, { additionalCents: proposed.budget_cents * proposed.duration_days, adCampaignId: proposed.id });
  if (blocked) return blocked;
  const post = proposed.source_post_id ? await queryOne<Post>(`select * from posts where id=$1`, [proposed.source_post_id]) : null;
  const objectStoryId = post?.external_post_id ?? (post ? `mock_story_${post.id}` : `mock_story_${proposed.id}`);
  try {
    const result = await getMarketingAdapter().boostPost({
      brand, objectStoryId, name: proposed.name, dailyBudgetCents: proposed.budget_cents,
      durationDays: proposed.duration_days, audience: proposed.audience,
    });
    await query(
      `update ad_campaigns set status='active', external_campaign_id=$1, external_adset_id=$2, external_ad_id=$3,
         starts_at=now(), ends_at=now()+($4||' days')::interval, plan=plan||$5::jsonb where id=$6`,
      [result.campaignId, result.adsetId, result.adId, String(proposed.duration_days),
       JSON.stringify({ preview_url: result.previewUrl }), proposed.id],
    );
    await logAdApproval({ brandId: brand.id, adCampaignId: proposed.id, action: "boost",
      after: { external_campaign_id: result.campaignId, budget_cents: proposed.budget_cents }, note: "SMS yes on boost" });
    await recordSpend({ brandId: brand.id, adCampaignId: proposed.id, amountCents: proposed.budget_cents,
      source: result.campaignId.startsWith("mock_") ? "mock" : "estimate", meta: { kind: "boost_launch" } });
    return `Boost is live ✅\n${formatCents(proposed.budget_cents)}/day for ${proposed.duration_days} day${proposed.duration_days === 1 ? "" : "s"}.\n` +
      (result.previewUrl ? `Track: ${result.previewUrl}\n` : "") + `Say "pause ads" or "kill the boost" anytime.`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await query(`update ad_campaigns set status='cancelled' where id=$1`, [proposed.id]);
    return `Couldn't start the boost (${detail}). Check ad account permissions, or say "connect ad account" for a fresh link.`;
  }
}

export async function cancelProposedBoost(proposed: AdCampaign): Promise<string> {
  await query(`update ad_campaigns set status='cancelled' where id=$1`, [proposed.id]);
  await logAdApproval({ brandId: proposed.brand_id, adCampaignId: proposed.id, action: "reject", note: "SMS no on boost" });
  return "No worries — boost cancelled. Nothing spent.";
}
