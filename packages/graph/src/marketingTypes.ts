import type { Brand, AdObjective } from "@pulse/shared";

/** Ad account returned from Meta Marketing API (or mock). */
export type MarketingAdAccount = {
  id: string;
  account_id: string;
  name: string;
  currency?: string;
  account_status?: number;
};

export type CreateCampaignInput = {
  brand: Brand;
  name: string;
  objective: AdObjective;
  /** Daily budget in cents (account currency). */
  dailyBudgetCents: number;
  /** Audience targeting bits — mapped to Meta targeting spec in live. */
  audience: {
    label?: string;
    meta_type?: string;
    interests?: string[];
    geo?: string;
    age_min?: number;
    age_max?: number;
  };
  creative: {
    primary_text: string;
    headline?: string;
    cta?: string;
    /** Page post id for boost, or media URLs for new creative. */
    object_story_id?: string;
    image_urls?: string[];
    video_url?: string;
  };
  durationDays: number;
};

export type CreateCampaignResult = {
  campaignId: string;
  adsetId: string;
  adId: string;
  status: "ACTIVE" | "PAUSED" | "PENDING_REVIEW";
  previewUrl: string | null;
};

export type BoostPostInput = {
  brand: Brand;
  /** Meta page post id (or mock post id). */
  objectStoryId: string;
  name: string;
  dailyBudgetCents: number;
  durationDays: number;
  audience: CreateCampaignInput["audience"];
};

export type CampaignInsights = {
  spendCents: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  messages: number;
  purchases: number;
  cpaCents: number | null;
  roas: number | null;
};

export type PastAdSummary = {
  id: string;
  name: string;
  status: string;
  objective: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  ctr: number;
  results: number;
  resultType: string;
};

/**
 * Meta Marketing API surface used by Phase F.
 * Mock never hits the network; Live calls real Graph endpoints when tokens exist.
 */
export interface MarketingAdapter {
  listAdAccounts(accessToken: string): Promise<MarketingAdAccount[]>;

  createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult>;

  boostPost(input: BoostPostInput): Promise<CreateCampaignResult>;

  pauseCampaign(brand: Brand, externalCampaignId: string): Promise<void>;

  resumeCampaign(brand: Brand, externalCampaignId: string): Promise<void>;

  killCampaign(brand: Brand, externalCampaignId: string): Promise<void>;

  updateBudget(
    brand: Brand,
    externalAdsetId: string,
    dailyBudgetCents: number,
  ): Promise<void>;

  fetchCampaignInsights(brand: Brand, externalCampaignId: string): Promise<CampaignInsights>;

  listPastAds(brand: Brand, limit?: number): Promise<PastAdSummary[]>;
}
