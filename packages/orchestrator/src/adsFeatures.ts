import {
  query, queryOne, type Brand, type BrandFeatures, type AdsSpendCaps,
  type AdApprovalAction, type AdCampaign,
} from "@pulse/shared";

const DEFAULT_FEATURES: Required<BrandFeatures> = {
  autopilot: true,
  auto_replies: true,
  lead_handoff: true,
  ads: false,
  ads_autopilot: false,
  crm_webhook: false, // Phase I — see docs/PHASE_I_CRM_SCOPE.md
};
const DEFAULT_CAPS: Required<AdsSpendCaps> = { weekly_cents: 50_000, campaign_cents: 20_000 };

export function brandFeatures(brand: Brand): Required<BrandFeatures> {
  const f = brand.features ?? {};
  return {
    autopilot: f.autopilot ?? DEFAULT_FEATURES.autopilot,
    auto_replies: f.auto_replies ?? DEFAULT_FEATURES.auto_replies,
    lead_handoff: f.lead_handoff ?? DEFAULT_FEATURES.lead_handoff,
    ads: f.ads ?? DEFAULT_FEATURES.ads,
    ads_autopilot: f.ads_autopilot ?? DEFAULT_FEATURES.ads_autopilot,
    crm_webhook: f.crm_webhook ?? DEFAULT_FEATURES.crm_webhook,
  };
}
export function adsEnabled(brand: Brand): boolean { return brandFeatures(brand).ads === true; }
export function adsAutopilotOn(brand: Brand): boolean { return brandFeatures(brand).ads_autopilot === true; }
export function isAdsConnected(brand: Brand): boolean {
  return Boolean(brand.ad_account_id && brand.ads_tokens_encrypted);
}
export function spendCaps(brand: Brand): Required<AdsSpendCaps> {
  const c = brand.ads_spend_caps ?? {};
  return {
    weekly_cents: c.weekly_cents ?? DEFAULT_CAPS.weekly_cents,
    campaign_cents: c.campaign_cents ?? DEFAULT_CAPS.campaign_cents,
  };
}
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
export async function setBrandFeatures(brandId: string, patch: Partial<BrandFeatures>): Promise<BrandFeatures> {
  const row = await queryOne<Brand>(`select features from brands where id = $1`, [brandId]);
  const next = { ...(row?.features ?? {}), ...patch };
  await query(`update brands set features = $1::jsonb where id = $2`, [JSON.stringify(next), brandId]);
  return next;
}
export async function setSpendCaps(brandId: string, patch: Partial<AdsSpendCaps>): Promise<AdsSpendCaps> {
  const row = await queryOne<Brand>(`select ads_spend_caps from brands where id = $1`, [brandId]);
  const next = { ...(row?.ads_spend_caps ?? {}), ...patch };
  await query(`update brands set ads_spend_caps = $1::jsonb where id = $2`, [JSON.stringify(next), brandId]);
  return next;
}
export async function logAdApproval(input: {
  brandId: string; adCampaignId?: string | null; action: AdApprovalAction; actor?: string;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  note?: string | null; messageId?: string | null;
}): Promise<void> {
  await query(
    `insert into ad_approvals (brand_id, ad_campaign_id, action, actor, before, after, note, message_id)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [input.brandId, input.adCampaignId ?? null, input.action, input.actor ?? "owner",
     input.before ? JSON.stringify(input.before) : null, input.after ? JSON.stringify(input.after) : null,
     input.note ?? null, input.messageId ?? null],
  );
}
export async function recordSpend(input: {
  brandId: string; adCampaignId?: string | null; amountCents: number;
  source?: "sync" | "mock" | "manual" | "estimate"; meta?: Record<string, unknown>;
}): Promise<void> {
  if (input.amountCents <= 0) return;
  await query(
    `insert into ad_spend_logs (brand_id, ad_campaign_id, amount_cents, source, meta) values ($1,$2,$3,$4,$5::jsonb)`,
    [input.brandId, input.adCampaignId ?? null, input.amountCents, input.source ?? "sync", JSON.stringify(input.meta ?? {})],
  );
}
export async function weeklySpendCents(brandId: string): Promise<number> {
  const row = await queryOne<{ sum: string | null }>(
    `select coalesce(sum(amount_cents),0)::text as sum from ad_spend_logs where brand_id=$1 and occurred_at > now() - interval '7 days'`,
    [brandId],
  );
  return Number(row?.sum ?? 0);
}
export async function campaignSpendCents(adCampaignId: string): Promise<number> {
  const row = await queryOne<{ sum: string | null }>(
    `select coalesce(sum(amount_cents),0)::text as sum from ad_spend_logs where ad_campaign_id=$1`, [adCampaignId],
  );
  return Number(row?.sum ?? 0);
}
export async function assertCanSpend(
  brand: Brand, opts: { additionalCents: number; adCampaignId?: string | null },
): Promise<string | null> {
  if (brand.account_type === "personal") {
    return 'Ads aren\'t available on personal accounts. I can still plan niche content and post organically.';
  }
  if (!adsEnabled(brand)) {
    return 'Ads are switched off for this brand. Reply "enable ads" to turn them on (I\'ll also need your ad account connected).';
  }
  if (!isAdsConnected(brand)) return null;
  const caps = spendCaps(brand);
  const weekly = await weeklySpendCents(brand.id);
  if (weekly + opts.additionalCents > caps.weekly_cents) {
    return `That would breach your weekly ads cap (${formatCents(caps.weekly_cents)}). You've used ${formatCents(weekly)} this week. Reply "raise weekly cap to $X" or pick a smaller budget.`;
  }
  if (opts.adCampaignId) {
    const camp = await queryOne<AdCampaign>(`select * from ad_campaigns where id=$1`, [opts.adCampaignId]);
    const campCap = camp?.campaign_cap_cents ?? caps.campaign_cents;
    const spent = await campaignSpendCents(opts.adCampaignId);
    if (spent + opts.additionalCents > campCap) {
      return `That would breach this campaign's cap (${formatCents(campCap)}). Spent so far: ${formatCents(spent)}.`;
    }
  } else if (opts.additionalCents > caps.campaign_cents) {
    return `That budget is above your per-campaign cap (${formatCents(caps.campaign_cents)}).`;
  }
  return null;
}
export function adsDisabledMessage(): string {
  return 'Ads are off right now. Reply "enable ads" if you want me to run paid Meta ads and boosts — I\'ll confirm before any spend.';
}
