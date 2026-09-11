import { createHash } from "node:crypto";
import type { Brand } from "@pulse/shared";
import type {
  MarketingAdapter,
  MarketingAdAccount,
  CreateCampaignInput,
  CreateCampaignResult,
  BoostPostInput,
  CampaignInsights,
  PastAdSummary,
} from "./marketingTypes.js";

function hashHex(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Marketing API stand-in. Used when GRAPH_MODE=mock.
 * Never spends real money; returns stable fake ids + insights.
 */
export class MockMarketingAdapter implements MarketingAdapter {
  async listAdAccounts(accessToken: string): Promise<MarketingAdAccount[]> {
    const suffix = hashHex(accessToken).slice(0, 8);
    return [
      {
        id: `act_mock_${suffix}`,
        account_id: `mock_${suffix}`,
        name: "Mock Ad Account",
        currency: "USD",
        account_status: 1,
      },
    ];
  }

  async createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
    const fp = hashHex(
      `${input.brand.id}|${input.name}|${input.objective}|${input.dailyBudgetCents}|${Date.now()}`,
    ).slice(0, 12);
    console.log(
      `[marketing:mock] createCampaign brand=${input.brand.id} objective=${input.objective} budget=${input.dailyBudgetCents} -> ${fp}`,
    );
    return {
      campaignId: `mock_camp_${fp}`,
      adsetId: `mock_adset_${fp}`,
      adId: `mock_ad_${fp}`,
      status: "ACTIVE",
      previewUrl: `https://mock.marketing.local/campaign/${fp}`,
    };
  }

  async boostPost(input: BoostPostInput): Promise<CreateCampaignResult> {
    const fp = hashHex(`${input.brand.id}|boost|${input.objectStoryId}|${Date.now()}`).slice(0, 12);
    console.log(
      `[marketing:mock] boostPost brand=${input.brand.id} post=${input.objectStoryId} -> ${fp}`,
    );
    return {
      campaignId: `mock_boost_${fp}`,
      adsetId: `mock_boost_adset_${fp}`,
      adId: `mock_boost_ad_${fp}`,
      status: "ACTIVE",
      previewUrl: `https://mock.marketing.local/boost/${fp}`,
    };
  }

  async pauseCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    console.log(`[marketing:mock] pause brand=${brand.id} campaign=${externalCampaignId}`);
  }

  async resumeCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    console.log(`[marketing:mock] resume brand=${brand.id} campaign=${externalCampaignId}`);
  }

  async killCampaign(brand: Brand, externalCampaignId: string): Promise<void> {
    console.log(`[marketing:mock] kill brand=${brand.id} campaign=${externalCampaignId}`);
  }

  async updateBudget(brand: Brand, externalAdsetId: string, dailyBudgetCents: number): Promise<void> {
    console.log(
      `[marketing:mock] updateBudget brand=${brand.id} adset=${externalAdsetId} daily=${dailyBudgetCents}`,
    );
  }

  async fetchCampaignInsights(brand: Brand, externalCampaignId: string): Promise<CampaignInsights> {
    const rng = mulberry32(seedFromString(`${brand.id}:${externalCampaignId}`));
    const impressions = Math.floor(800 + rng() * 12000);
    const clicks = Math.floor(impressions * (0.008 + rng() * 0.04));
    const spendCents = Math.floor(1500 + rng() * 18000);
    const leads = Math.floor(clicks * (0.05 + rng() * 0.15));
    const purchases = Math.floor(leads * (0.1 + rng() * 0.3));
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpaCents = leads > 0 ? Math.round(spendCents / leads) : null;
    const roas = spendCents > 0 ? Number(((purchases * 4500) / spendCents).toFixed(2)) : null;
    return { spendCents, impressions, clicks, ctr, leads, messages: Math.floor(leads * 0.4), purchases, cpaCents, roas };
  }

  async listPastAds(brand: Brand, limit = 8): Promise<PastAdSummary[]> {
    const rng = mulberry32(seedFromString(`past:${brand.id}`));
    const n = Math.min(limit, 5);
    const out: PastAdSummary[] = [];
    const objectives = ["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_AWARENESS", "OUTCOME_SALES", "OUTCOME_ENGAGEMENT"];
    for (let i = 0; i < n; i++) {
      const impressions = Math.floor(1000 + rng() * 20000);
      const clicks = Math.floor(impressions * (0.01 + rng() * 0.03));
      const spendCents = Math.floor(2000 + rng() * 25000);
      const results = Math.floor(5 + rng() * 80);
      out.push({
        id: `mock_past_${i}_${hashHex(brand.id).slice(0, 6)}`,
        name: `Past ad ${i + 1}`,
        status: i === 0 ? "ACTIVE" : "PAUSED",
        objective: objectives[i % objectives.length]!,
        spendCents,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
        results,
        resultType: i % 2 === 0 ? "leads" : "link_clicks",
      });
    }
    return out;
  }
}
