import type { Brand, ServerEnv } from "@pulse/shared";
import { decryptJson, getServerEnv } from "@pulse/shared";
import type {
  MarketingAdapter, MarketingAdAccount, CreateCampaignInput, CreateCampaignResult,
  BoostPostInput, CampaignInsights, PastAdSummary,
} from "./marketingTypes.js";

/** Prefer confirmed booking URL, then website, then Facebook Page. */
function adDestinationUrl(brand: Brand): string {
  const facts = brand.facts as { booking_link?: string } | null | undefined;
  const offers = brand.offers as { booking_link?: string } | null | undefined;
  const booking = facts?.booking_link || offers?.booking_link;
  if (booking && /^https?:\/\//i.test(booking)) return booking;
  if (brand.website) return brand.website;
  return brand.fb_page_id ? `https://facebook.com/${brand.fb_page_id}` : "https://facebook.com/";
}

interface AdsTokens { access_token?: string; ad_account_id?: string; [key: string]: unknown }

const OBJECTIVE_MAP: Record<string, string> = {
  awareness: "OUTCOME_AWARENESS", traffic: "OUTCOME_TRAFFIC", leads: "OUTCOME_LEADS",
  messages: "OUTCOME_ENGAGEMENT", sales: "OUTCOME_SALES",
};

function graphUrl(env: ServerEnv, path: string): string {
  return `https://graph.facebook.com/${env.META_GRAPH_VERSION}${path}`;
}
function getAdsToken(brand: Brand): string {
  if (!brand.ads_tokens_encrypted) throw new Error(`Brand ${brand.id} has no ads_tokens_encrypted — connect an ad account first`);
  const bag = decryptJson<AdsTokens>(brand.ads_tokens_encrypted);
  if (!bag.access_token) throw new Error(`Brand ${brand.id} ads token bag missing access_token`);
  return bag.access_token;
}
function adAccountPath(brand: Brand): string {
  const id = brand.ad_account_id;
  if (!id) throw new Error(`Brand ${brand.id} has no ad_account_id`);
  return id.startsWith("act_") ? id : `act_${id}`;
}
async function graphFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(json?.error?.message ?? `Marketing API error ${res.status}`);
  return json;
}
function centsToMetaBudget(cents: number): string { return String(Math.max(100, Math.round(cents))); }
function targetingFromAudience(audience: CreateCampaignInput["audience"]): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    age_min: audience.age_min ?? 25, age_max: audience.age_max ?? 55,
    geo_locations: { countries: [audience.geo && audience.geo.length === 2 ? audience.geo.toUpperCase() : "US"] },
  };
  if (audience.interests?.length) targeting.flexible_spec = [{ interests: audience.interests.map((name) => ({ name })) }];
  return targeting;
}

/** Live Meta Marketing API — real endpoint shapes; throws clearly when tokens missing. */
export class LiveMarketingAdapter implements MarketingAdapter {
  async listAdAccounts(accessToken: string): Promise<MarketingAdAccount[]> {
    const env = getServerEnv();
    const url = new URL(graphUrl(env, "/me/adaccounts"));
    url.searchParams.set("fields", "id,account_id,name,currency,account_status");
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", accessToken);
    const body = await graphFetch(url.toString());
    return (body.data ?? []).map((a: any) => ({
      id: String(a.id), account_id: String(a.account_id ?? a.id), name: String(a.name ?? "Ad Account"),
      currency: a.currency ? String(a.currency) : undefined,
      account_status: typeof a.account_status === "number" ? a.account_status : undefined,
    }));
  }

  async createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
    const env = getServerEnv();
    const token = getAdsToken(input.brand);
    const act = adAccountPath(input.brand);
    const objective = OBJECTIVE_MAP[input.objective] ?? "OUTCOME_TRAFFIC";
    const campaign = await graphFetch(graphUrl(env, `/${act}/campaigns`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: input.name, objective, status: "PAUSED", special_ad_categories: "[]", access_token: token }),
    });
    const endTime = new Date(Date.now() + input.durationDays * 86400000).toISOString();
    const adset = await graphFetch(graphUrl(env, `/${act}/adsets`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: `${input.name} ad set`, campaign_id: String(campaign.id),
        daily_budget: centsToMetaBudget(input.dailyBudgetCents), billing_event: "IMPRESSIONS",
        optimization_goal: input.objective === "leads" ? "LEAD_GENERATION" : "LINK_CLICKS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP", targeting: JSON.stringify(targetingFromAudience(input.audience)),
        status: "PAUSED", end_time: endTime, access_token: token,
      }),
    });
    const creativePayload: Record<string, string> = { name: `${input.name} creative`, access_token: token };
    if (input.creative.object_story_id) creativePayload.object_story_id = input.creative.object_story_id;
    else {
      creativePayload.object_story_spec = JSON.stringify({
        page_id: input.brand.fb_page_id,
        link_data: {
          message: input.creative.primary_text, name: input.creative.headline ?? input.name,
          link: adDestinationUrl(input.brand),
          call_to_action: {
            type: (input.creative.cta ??
              (adDestinationUrl(input.brand).includes("book") || input.brand.facts?.booking_link
                ? "BOOK_NOW"
                : "LEARN_MORE")
            ).toUpperCase().replace(/\s+/g, "_"),
          },
          ...(input.creative.image_urls?.[0] ? { picture: input.creative.image_urls[0] } : {}),
        },
      });
    }
    const creative = await graphFetch(graphUrl(env, `/${act}/adcreatives`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(creativePayload),
    });
    const ad = await graphFetch(graphUrl(env, `/${act}/ads`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: `${input.name} ad`, adset_id: String(adset.id),
        creative: JSON.stringify({ creative_id: String(creative.id) }), status: "PAUSED", access_token: token,
      }),
    });
    for (const id of [campaign.id, adset.id, ad.id]) {
      await graphFetch(graphUrl(env, `/${id}`), {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
      });
    }
    return {
      campaignId: String(campaign.id), adsetId: String(adset.id), adId: String(ad.id), status: "ACTIVE",
      previewUrl: `https://www.facebook.com/adsmanager/manage/campaigns?act=${act.replace(/^act_/, "")}&selected_campaign_ids=${campaign.id}`,
    };
  }

  async boostPost(input: BoostPostInput): Promise<CreateCampaignResult> {
    return this.createCampaign({
      brand: input.brand, name: input.name, objective: "traffic", dailyBudgetCents: input.dailyBudgetCents,
      audience: input.audience, creative: { primary_text: "Boosted post", object_story_id: input.objectStoryId, cta: "LEARN_MORE" },
      durationDays: input.durationDays,
    });
  }

  async pauseCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    const env = getServerEnv(); const token = getAdsToken(brand);
    await graphFetch(graphUrl(env, `/${externalCampaignId}`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "PAUSED", access_token: token }),
    });
  }
  async resumeCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    const env = getServerEnv(); const token = getAdsToken(brand);
    await graphFetch(graphUrl(env, `/${externalCampaignId}`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "ACTIVE", access_token: token }),
    });
  }
  async killCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    const env = getServerEnv(); const token = getAdsToken(brand);
    await graphFetch(graphUrl(env, `/${externalCampaignId}`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "DELETED", access_token: token }),
    });
  }
  async updateBudget(brand: Brand, externalAdsetId: string, dailyBudgetCents: number): Promise<void> {
    const env = getServerEnv(); const token = getAdsToken(brand);
    await graphFetch(graphUrl(env, `/${externalAdsetId}`), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ daily_budget: centsToMetaBudget(dailyBudgetCents), access_token: token }),
    });
  }
  async fetchCampaignInsights(brand: Brand, externalCampaignId: string): Promise<CampaignInsights> {
    const env = getServerEnv(); const token = getAdsToken(brand);
    const url = new URL(graphUrl(env, `/${externalCampaignId}/insights`));
    url.searchParams.set("fields", "spend,impressions,clicks,ctr,actions,cost_per_action_type,purchase_roas");
    url.searchParams.set("date_preset", "last_7d"); url.searchParams.set("access_token", token);
    const body = await graphFetch(url.toString());
    const row = (body.data ?? [])[0] ?? {};
    const spendCents = Math.round(Number(row.spend ?? 0) * 100);
    const impressions = Number(row.impressions ?? 0); const clicks = Number(row.clicks ?? 0);
    const actions: Array<{ action_type: string; value: string }> = row.actions ?? [];
    const leads = Number(actions.find((a) => a.action_type.includes("lead"))?.value ?? 0);
    const messages = Number(actions.find((a) => a.action_type.includes("message"))?.value ?? 0);
    const purchases = Number(actions.find((a) => a.action_type.includes("purchase"))?.value ?? 0);
    const cpa = (row.cost_per_action_type ?? []).find((a: any) => String(a.action_type).includes("lead"));
    return {
      spendCents, impressions, clicks, ctr: Number(row.ctr ?? 0) / 100, leads, messages, purchases,
      cpaCents: cpa ? Math.round(Number(cpa.value) * 100) : leads > 0 ? Math.round(spendCents / leads) : null,
      roas: row.purchase_roas?.[0]?.value != null ? Number(row.purchase_roas[0].value) : null,
    };
  }
  async listPastAds(brand: Brand, limit = 8): Promise<PastAdSummary[]> {
    const env = getServerEnv(); const token = getAdsToken(brand); const act = adAccountPath(brand);
    const url = new URL(graphUrl(env, `/${act}/ads`));
    url.searchParams.set("fields", "id,name,status,campaign{objective},insights{spend,impressions,clicks,ctr,actions}");
    url.searchParams.set("limit", String(limit)); url.searchParams.set("access_token", token);
    const body = await graphFetch(url.toString());
    return (body.data ?? []).map((ad: any) => {
      const insight = ad.insights?.data?.[0] ?? {};
      const actions: Array<{ action_type: string; value: string }> = insight.actions ?? [];
      return {
        id: String(ad.id), name: String(ad.name ?? "Ad"), status: String(ad.status ?? "UNKNOWN"),
        objective: String(ad.campaign?.objective ?? "UNKNOWN"),
        spendCents: Math.round(Number(insight.spend ?? 0) * 100),
        impressions: Number(insight.impressions ?? 0), clicks: Number(insight.clicks ?? 0),
        ctr: Number(insight.ctr ?? 0) / 100, results: Number(actions[0]?.value ?? 0),
        resultType: actions[0]?.action_type ?? "results",
      };
    });
  }
}
