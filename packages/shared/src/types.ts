import { z } from "zod";

// ─── Enums (mirror the DB CHECK constraints) ────────────────
export const MessageDirection = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MessageDirection)[number];

export const MessageType = ["media", "instruction", "approval", "question", "edit", "other"] as const;
export type MessageType = (typeof MessageType)[number];

export const MediaKind = ["photo", "video"] as const;
export type MediaKind = (typeof MediaKind)[number];

export const MediaSource = ["client", "operator", "source"] as const;
export type MediaSource = (typeof MediaSource)[number];

export const Platform = ["instagram", "facebook", "x", "threads", "linkedin", "tiktok"] as const;
export type Platform = (typeof Platform)[number];

/** Chat-pickable publish destinations. */
export const PublishDestination = ["instagram", "facebook", "x", "threads", "linkedin", "tiktok"] as const;
export type PublishDestination = (typeof PublishDestination)[number];

/**
 * Platforms that stay on the fake feed even when GRAPH_MODE=live.
 * X is always mock-only until a paid tier is wired (still uses platformConfigured
 * mock fallback for the adapter path when X_CLIENT_ID is missing).
 * TikTok: public Direct Post needs TIKTOK_AUDIT_PASSED; without it live posts
 * are forced to SELF_ONLY (private). LinkedIn goes live once LINKEDIN_CLIENT_ID + tokens exist.
 */
export const MOCK_ONLY_PLATFORMS: readonly Platform[] = ["x"];

/** True when TikTok Content Posting audit has cleared for this deploy. */
export function tiktokAuditPassed(): boolean {
  const v = process.env.TIKTOK_AUDIT_PASSED;
  return v === "true" || v === "1" || v === "yes";
}

export function isMockOnlyPlatform(platform: Platform | string): boolean {
  // X remains mock-only for live confirmation until paid API is productized.
  // TikTok is no longer blanket mock-only — unaudited deploys still live-post privately.
  return platform === "x";
}

export function isPublishDestination(platform: string): platform is PublishDestination {
  return (PublishDestination as readonly string[]).includes(platform);
}

export function platformLabel(platform: string): string {
  switch (platform) {
    case "x":
      return "X";
    case "threads":
      return "Threads";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "linkedin":
      return "LinkedIn";
    case "tiktok":
      return "TikTok";
    default:
      return platform;
  }
}

// The post format the bot varies across — feed, carousel, story, and reel (video).
export const PostFormat = ["feed", "carousel", "story", "reel"] as const;
export type PostFormat = (typeof PostFormat)[number];

/** Async AI video generation job (Phase G4). */
export const AiVideoJobStatus = ["queued", "running", "ready", "failed", "cancelled"] as const;
export type AiVideoJobStatus = (typeof AiVideoJobStatus)[number];

export interface AiVideoJob {
  id: string;
  brand_id: string;
  prompt: string;
  status: AiVideoJobStatus;
  provider: string | null;
  model: string | null;
  source_media_ids: string[];
  result_media_id: string | null;
  post_id: string | null;
  cost_cents: number;
  aigc: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** t2v (default) or ugc multi-scene pipeline */
  kind?: "t2v" | "ugc";
  /** organic | ads | both — where the UGC output is meant to go */
  destination?: "organic" | "ads" | "both";
  /** Script/models/retune state for UGC jobs */
  pipeline?: Record<string, unknown>;
  preset_version?: string | null;
}

/** Kip self-kickoff job — work Kip queues for itself (user ask, verbal commit, or proactive). */
export const KipKickoffKind = [
  "first_batch",
  "draft_posts",
  "trend_draft",
  "competitor_draft",
] as const;
export type KipKickoffKind = (typeof KipKickoffKind)[number];

export const KipKickoffStatus = ["queued", "running", "done", "failed", "cancelled"] as const;
export type KipKickoffStatus = (typeof KipKickoffStatus)[number];

export const KipKickoffReason = ["user_request", "kip_commit", "system", "proactive"] as const;
export type KipKickoffReason = (typeof KipKickoffReason)[number];

export interface KipKickoff {
  id: string;
  brand_id: string;
  kind: KipKickoffKind;
  status: KipKickoffStatus;
  payload: Record<string, unknown>;
  reason: KipKickoffReason;
  source_message_id: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}


export const PostStatus = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "rejected",
] as const;
export type PostStatus = (typeof PostStatus)[number];

export const BrandStatus = ["active", "paused", "archived"] as const;
export type BrandStatus = (typeof BrandStatus)[number];

export const Approver = ["operator", "client"] as const;
export type Approver = (typeof Approver)[number];

export const TriggerKind = ["checkin", "report", "reminder", "alert"] as const;
export type TriggerKind = (typeof TriggerKind)[number];

export const ApprovalAction = [
  "draft_created",
  "approved",
  "edited",
  "rejected",
  "scheduled",
  "published",
  "publish_failed",
  "send_failed",
] as const;
export type ApprovalAction = (typeof ApprovalAction)[number];

// ─── Brand-voice profile (the "learning" — structured, not a model) ─

// The micro-tells that make writing sound like a specific person: how they
// punctuate, capitalise, sign off, which emojis they reach for and how often.
// Learned from real post history by the onboarding voice agent. Every field is
// defaulted, so older profiles (from the chat interview alone) still parse.
export const writingMechanicsSchema = z
  .object({
    emoji_frequency: z.string().default(""),       // narrative: "~1 per post, always trailing"
    favourite_emojis: z.array(z.string()).default([]),
    exclamation_usage: z.string().default(""),     // "rare — maybe 1 in 5 posts"
    ellipsis_usage: z.string().default(""),        // "loves a trailing ... for suspense"
    capitalisation: z.string().default(""),        // "all-lowercase" | "sentence case" | ...
    sentence_length: z.string().default(""),       // "short, punchy — 6-10 words"
    punctuation_quirks: z.array(z.string()).default([]),
    openers: z.array(z.string()).default([]),      // recurring first-line patterns
    sign_offs: z.array(z.string()).default([]),    // recurring closers
    hashtag_style: z.string().default(""),         // count, placement, examples
    cta_style: z.string().default(""),             // how they ask for the click/comment
    favourite_phrases: z.array(z.string()).default([]),
  })
  .default({});
export type WritingMechanics = z.infer<typeof writingMechanicsSchema>;

// How their photos look, learned by running real images through vision.
export const photoStyleSchema = z
  .object({
    overall_aesthetic: z.string().default(""),
    lighting: z.string().default(""),
    composition: z.string().default(""),
    colour_palette: z.array(z.string()).default([]),
    editing: z.string().default(""),               // "warm, high-contrast, film grain"
    common_subjects: z.array(z.string()).default([]),
    framing: z.string().default(""),               // "flat-lay", "candid", "posed portrait"
    recurring_motifs: z.array(z.string()).default([]),
  })
  .default({});
export type PhotoStyle = z.infer<typeof photoStyleSchema>;

export const brandVoiceProfileSchema = z.object({
  tone: z.array(z.string()).default([]),          // e.g. ["warm", "playful", "concise"]
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
  example_captions: z.array(z.string()).default([]),
  banned_words: z.array(z.string()).default([]),
  emoji_policy: z.enum(["none", "sparing", "liberal"]).default("sparing"),
  hashtag_policy: z.string().default(""),
  notes: z.array(z.string()).default([]),         // rolling learned notes from corrections
  // Enriched by the onboarding voice agent from real post history (additive).
  writing_mechanics: writingMechanicsSchema,
  photo_style: photoStyleSchema,
  analysis_source: z.string().default(""),        // "148 posts (instagram, facebook); 30 images"
  /** Verified proof lines the model may cite — never invent numbers beyond these. */
  proof_bank: z.array(z.string()).default([]),
  /** Public stances the brand will defend (may cost followers). */
  positions: z.array(z.string()).default([]),
});
export type BrandVoiceProfile = z.infer<typeof brandVoiceProfileSchema>;

export const emptyBrandVoiceProfile = (): BrandVoiceProfile =>
  brandVoiceProfileSchema.parse({});

/**
 * Coerce a DB/JSON blob into a full BrandVoiceProfile.
 * Empty `{}` from Postgres is truthy, so `?? emptyBrandVoiceProfile()` is not
 * enough — callers that touch `.notes.length` / `.tone.join` must normalize.
 */
export function normalizeBrandVoiceProfile(raw: unknown): BrandVoiceProfile {
  const parsed = brandVoiceProfileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : emptyBrandVoiceProfile();
}

// ─── Voice-analysis job state (async, run on the worker) ────────────
export type VoiceAnalysisStatus =
  | "none"
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export interface VoiceAnalysisState {
  status: VoiceAnalysisStatus;
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
  posts_analysed?: number;
  images_analysed?: number;
  platforms?: string[];
  error?: string;
}

// ─── Row shapes (mirror the tables in 0001_init.sql) ────────
export type AccountType = "business" | "personal";

export type OnboardingStatus =
  | "none"
  | "pending"
  | "awaiting_contact"
  | "awaiting_connect"
  | "reading_content"
  | "in_progress"
  | "wrapping_up"
  | "done";

export interface OnboardingTurnMsg {
  role: "user" | "assistant";
  content: string;
}

export interface OnboardingState {
  status: OnboardingStatus;
  /** Set when onboarding first reaches done — survives status parking so we never re-arm setup. */
  completed_at?: string;
  step?: number;
  turns?: number;
  type?: AccountType;
  transcript?: OnboardingTurnMsg[];
  answers?: Record<string, string>;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  is_admin: boolean;
  password_hash?: string | null;
  created_at: string;
  /** When set, the account is deactivated (soft-deleted) — see 0040. */
  deleted_at?: string | null;
}

/** A one-time passwordless login code (delivered through the agent thread). */
export interface LoginCode {
  id: string;
  phone: string;
  user_id: string | null;
  brand_id: string | null;
  code_encrypted: string;
  purpose: "login" | "signup" | "operator_unlock";
  attempts: number;
  delivered_at: string | null;
  consumed_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  client_phone: string;
  owner_user_id: string | null;
  account_type: AccountType | null;
  website: string | null;
  onboarding_state: OnboardingState;
  /** When Kip's contact card (.vcf / Linq share) was last delivered — once per brand. */
  contact_card_sent_at: string | null;
  brand_voice_profile: BrandVoiceProfile;
  voice_guide_md: string | null;
  voice_analysis_state: VoiceAnalysisState;
  ig_user_id: string | null;
  fb_page_id: string | null;
  fb_page_name: string | null;
  ig_username: string | null;
  platform_tokens_encrypted: string | null;
  platform_user_token_encrypted: string | null;
  // X (Twitter): the connected account and its OAuth 2.0 tokens ({access,refresh,expires_at}).
  x_user_id: string | null;
  x_username: string | null;
  x_tokens_encrypted: string | null;
  // Threads: the connected account and its long-lived token ({access_token,expires_at}).
  threads_user_id: string | null;
  threads_username: string | null;
  threads_tokens_encrypted: string | null;
  // LinkedIn Company Page: org URN + OAuth tokens ({access_token,refresh_token,expires_at}).
  linkedin_org_id: string | null;
  linkedin_org_name: string | null;
  linkedin_tokens_encrypted: string | null;
  linkedin_connected_at: string | null;
  // TikTok: open_id + Direct Post tokens; public live gated by TIKTOK_AUDIT_PASSED.
  tiktok_open_id: string | null;
  tiktok_display_name: string | null;
  tiktok_tokens_encrypted: string | null;
  tiktok_connected_at: string | null;
  /** Last TikTok privacy/music consent choices from the SMS connect UX. */
  tiktok_privacy_defaults?: TikTokPrivacyDefaults | null;
  meta_connected_at: string | null;
  facts: BusinessFacts;
  visual: VisualProfile;
  /** Ideal customer profile — SMS source of truth. */
  icp: BrandIcp;
  /** Researched + owner-confirmed pain points. */
  pain_points: BrandPainPoints;
  /** Category + differentiation one-liner. */
  positioning: BrandPositioning;
  /** Primary offer stack + claim constraints. */
  offers: BrandOffers;
  /** Per-capability toggles — ads defaults off until Phase F enables. */
  features?: BrandFeatures;
  /**
   * Encrypted (or plain https) Zapier/Make/n8n catch-hook URL for Phase I CRM push.
   * Prefer encrypted at rest via `encrypt()`.
   */
  crm_webhook_url?: string | null;
  ad_account_id?: string | null;
  ad_account_name?: string | null;
  ads_tokens_encrypted?: string | null;
  ads_connected_at?: string | null;
  ads_spend_caps?: AdsSpendCaps;
  approver: Approver;
  status: BrandStatus;
  created_at: string;
  updated_at: string;
}

/** TikTok Direct Post privacy + music consent (required UX). */
export interface TikTokPrivacyDefaults {
  privacy_level: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  /** Owner confirmed commercial music / branded content rules. */
  music_usage_confirmed: boolean;
  /** Disclose AI-generated content when posting AI video. */
  aigc_disclosure: boolean;
}

/** Per-brand capability toggles. */
export interface BrandFeatures {
  autopilot?: boolean;
  auto_replies?: boolean;
  lead_handoff?: boolean;
  ads?: boolean;
  ads_autopilot?: boolean;
  /**
   * Phase I — when true, qualified leads may auto-POST to the owner's
   * CRM webhook (Zapier/Make/n8n/etc.). See docs/PHASE_I_CRM_SCOPE.md.
   */
  crm_webhook?: boolean;
}

export interface AdsSpendCaps {
  weekly_cents?: number;
  campaign_cents?: number;
}

export const AdObjective = ["awareness", "traffic", "leads", "messages", "sales"] as const;
export type AdObjective = (typeof AdObjective)[number];

export const AdCampaignStatus = [
  "proposed", "preview", "active", "paused", "done", "cancelled", "killed",
] as const;
export type AdCampaignStatus = (typeof AdCampaignStatus)[number];

export const AdCampaignKind = ["campaign", "boost"] as const;
export type AdCampaignKind = (typeof AdCampaignKind)[number];

export const AdCreativeSource = ["organic", "static", "carousel", "video"] as const;
export type AdCreativeSource = (typeof AdCreativeSource)[number];

export interface AdAudience {
  label?: string;
  meta_type?: "interest" | "lookalike" | "retargeting" | "broad" | "custom";
  interests?: string[];
  geo?: string;
  age_min?: number;
  age_max?: number;
  notes?: string;
}

export interface AdCreativeSpec {
  source: AdCreativeSource;
  primary_text?: string;
  headline?: string;
  cta?: string;
  media_ids?: string[];
  source_post_id?: string;
  notes?: string;
}

export interface AdCampaignPlan {
  step?: string;
  pending_budget_cents?: number;
  scale_suggestion?: string;
  pause_suggestion?: string;
  [key: string]: unknown;
}

export interface AdCampaignMetrics {
  spend_cents?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  leads?: number;
  messages?: number;
  purchases?: number;
  cpa_cents?: number;
  roas?: number;
  [key: string]: unknown;
}

export interface AdCampaign {
  id: string;
  brand_id: string;
  name: string;
  objective: AdObjective;
  status: AdCampaignStatus;
  audience: AdAudience;
  offer_ref: Record<string, unknown>;
  creative: AdCreativeSpec;
  budget_cents: number;
  duration_days: number;
  weekly_cap_cents: number | null;
  campaign_cap_cents: number | null;
  external_campaign_id: string | null;
  external_adset_id: string | null;
  external_ad_id: string | null;
  source_post_id: string | null;
  kind: AdCampaignKind;
  metrics: AdCampaignMetrics;
  plan: AdCampaignPlan;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export const AdApprovalAction = [
  "launch","boost","pause","resume","kill","budget_edit","scale","enable_ads","connect","cap_breach","reject",
] as const;
export type AdApprovalAction = (typeof AdApprovalAction)[number];

export interface AdApproval {
  id: string;
  brand_id: string;
  ad_campaign_id: string | null;
  action: AdApprovalAction;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  message_id: string | null;
  created_at: string;
}

export interface AdSpendLog {
  id: string;
  brand_id: string;
  ad_campaign_id: string | null;
  amount_cents: number;
  currency: string;
  source: "sync" | "mock" | "manual" | "estimate";
  occurred_at: string;
  meta: Record<string, unknown>;
  created_at: string;
}


export interface Message {
  id: string;
  brand_id: string;
  direction: MessageDirection;
  channel: string;
  body: string | null;
  media_ids: string[];
  type: MessageType | null;
  provider_message_sid: string | null;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  brand_id: string;
  storage_path: string;
  kind: MediaKind;
  source: MediaSource;
  content_type: string | null;
  used_in_post_id: string | null;
  // The provider's own id for the item this was pulled from (source media only).
  source_external_id?: string | null;
  created_at: string;
}

// The niche-research custom plan proposed at onboarding.
export interface PlanPillar {
  key: string;
  name: string;
  description: string;
  posts_per_week: number;
  format_bias?: PostFormat;
  /** Jake-style content job: proof | teach | opinion | story | offer */
  content_job?: "proof" | "teach" | "opinion" | "story" | "offer";
}
export interface NichePlan {
  summary: string; // one punchy line for the SMS
  pillars: PlanPillar[];
  format_mix: string; // e.g. "carousel-heavy — ~50% carousel, 30% feed, 20% story"
  best_times: string; // e.g. "Tue & Thu 6–8pm, Sat mornings"
  starter_ideas: string[];
  /** Optional job-mix line, e.g. "1 proof, 2 teach, 1 opinion, 0.5 story, 0.5 offer /wk" */
  job_mix?: string;
}
export interface ContentPlan {
  id: string;
  brand_id: string;
  niche: string | null;
  exemplars: string | null;
  plan: NichePlan | null;
  status: "pending" | "proposed" | "accepted" | "failed";
  /** When Kip promised to text the plan (concrete ETA). */
  promised_at: string | null;
  created_at: string;
  updated_at: string;
}

// A competitor the owner asked us to watch; a weekly sweep diffs it and reports.
export interface CompetitorWatch {
  id: string;
  brand_id: string;
  name: string;
  handles: string | null;
  last_snapshot: string | null;
  last_watched_at: string | null;
  created_at: string;
}

/** Phase D research snapshot kinds Kip can cite in SMS. */
export const ResearchSnapshotKind = [
  "niche",
  "competitor",
  "customers",
  "ads",
  "strategy",
  "plan",
] as const;
export type ResearchSnapshotKind = (typeof ResearchSnapshotKind)[number];

/** Structured findings persisted with a research snapshot. */
export interface ResearchFindings {
  pain_language?: string[];
  competitor_hooks?: string[];
  competitor_ctas?: string[];
  ad_library_angles?: string[];
  organic_themes?: string[];
  sources?: string[];
  notes?: string;
  /** Outlier-style swipe formulas (views÷account median angles). */
  swipe_formulas?: string[];
  /** Concrete angles that outperformed a peer median. */
  outlier_angles?: string[];
  [key: string]: unknown;
}

export interface ResearchSnapshot {
  id: string;
  brand_id: string;
  kind: ResearchSnapshotKind;
  subject: string | null;
  summary: string;
  findings: ResearchFindings;
  created_at: string;
}

export const VisualExemplarSource = ["niche", "competitor", "research"] as const;
export type VisualExemplarSource = (typeof VisualExemplarSource)[number];

/** Public visual exemplar for the design composer (URL or media ref). */
export interface VisualExemplar {
  id: string;
  brand_id: string;
  snapshot_id: string | null;
  source: VisualExemplarSource;
  url: string | null;
  media_id: string | null;
  label: string | null;
  notes: string | null;
  competitor_name: string | null;
  created_at: string;
}

/** Pieces inside a strategy brief pending SMS approval. */
export interface StrategyBriefPieces {
  summary?: string;
  icp?: BrandIcp;
  pains?: BrandPainPoints;
  positioning?: BrandPositioning;
  offers?: BrandOffers;
}

export type StrategyBriefStatus = "proposed" | "accepted" | "revised" | "cancelled";

export interface StrategyBrief {
  id: string;
  brand_id: string;
  status: StrategyBriefStatus;
  pieces: StrategyBriefPieces;
  created_at: string;
  updated_at: string;
}

// A connected photo source the agent polls for new media (Phase C auto-pull).
export const ContentSourceKind = ["dropbox"] as const;
export type ContentSourceKind = (typeof ContentSourceKind)[number];

export interface ContentSource {
  id: string;
  brand_id: string;
  kind: ContentSourceKind;
  external_ref: string | null; // album / folder id
  encrypted_token: string | null; // OAuth token (encryptJson), if the source has its own
  cursor: string | null; // provider pagination/sync cursor
  last_synced_at: string | null;
  created_at: string;
}

export interface Post {
  id: string;
  brand_id: string;
  caption: string | null;
  media_ids: string[];
  // The client's original photo(s), kept so an image-edit request can re-style
  // from the source rather than compounding edits on an already-styled image.
  source_media_ids: string[] | null;
  // How the image was styled ({ wants_text, headline }) so a re-edit re-applies it.
  // aigc / ai_video_job_id mark AI-generated video for TikTok AIGC disclosure.
  style_meta: {
    wants_text?: boolean;
    headline?: string;
    aigc?: boolean;
    ai_video_job_id?: string;
    reel?: boolean;
    [key: string]: unknown;
  } | null;
  /**
   * Confirmed destination / booking URL offer for this post (organic or creative).
   * Not an SMS connect deep-link. See LinkOffer.
   */
  link_offer?: LinkOffer | null;
  // Content pillar this post belongs to, and autopilot bookkeeping.
  pillar_id: string | null;
  // feed (single) / carousel (multi-image) / story (24h). Drives how it publishes.
  format: PostFormat;
  is_auto: boolean;
  hold_notified_at: string | null;
  // When we last nudged the client that this draft is still awaiting their yes
  // (the ~24h chase fires once per post).
  chased_at: string | null;
  campaign_id: string | null;
  platform: Platform;
  /** Owner-picked channels for this draft. Empty → use `platform` only. */
  destinations: Platform[];
  /** Per-channel caption variants (X ≤280, Threads ≤500). */
  captions: Partial<Record<Platform, string>>;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  external_post_id: string | null;
  engagement: Record<string, unknown>;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-brand weekly AI generation spend (USD), stored under brands.facts.ai_spend. */
export interface AiSpendFacts {
  week_key: string;
  spent_usd: number;
}

/** Plan choice collected on the payment UI (no processor wired yet). */
export interface BrandPlanFacts {
  tier: "pro" | "max";
  /** Billing interval — annual is shown as monthly equivalent on the landing page. */
  interval: "month" | "year";
  selected_at?: string;
}

/** Fake / future payment markers on the brand. Not a paywall. */
export interface BrandPaymentFacts {
  /** Set when the owner submits the payment UI (Stripe not connected yet). */
  submitted_at?: string;
  /** Display-only status until a real processor is plugged in. */
  status?: "submitted" | "active" | "none";
}

/** Owner must SMS-confirm a discovered booking/destination URL before Kip saves or uses it. */
export interface PendingDestinationLink {
  url: string;
  candidates?: string[];
  /** Why we asked — e.g. "post", "ads", "onboarding", "update". */
  context?: string;
  requested_at: string;
}

/**
 * Per-post destination link offer (organic captions / Stories / ads).
 * Distinct from SMS connect deep-links (`/c/[token]`).
 */
export type LinkOfferMode = "comment_dm" | "caption_url" | "story_cta" | "ad_destination";

export interface LinkOffer {
  url: string;
  mode: LinkOfferMode;
  /** Comment keyword that triggers a private DM with the URL (IG/FB). */
  keyword?: string;
  confirmed_at: string;
}

/** Ledger of a one-shot private reply / DM that delivered a destination link. */
export interface LinkFulfillment {
  method: "private_reply" | "dm" | "public_reply";
  url: string;
  sent_at: string;
  external_message_id?: string | null;
}

export interface BusinessFacts {
  /** When true, this brand is a Twilio-free lab sandbox — never expose in live product UIs. */
  lab?: boolean;
  // The owner's name, for personal address ("Morning, Sarah!").
  owner_name?: string;
  hours?: string;
  address?: string;
  service_area?: string;
  services?: Array<{ name: string; price?: string }>;
  booking_link?: string;
  policies?: string;
  faqs?: Array<{ q: string; a: string }>;
  differentiators?: string;
  /** Rolling weekly AI video/specialty spend estimate (ops cost guard). */
  ai_spend?: AiSpendFacts;
  /** Preference chosen on signup / pricing before checkout (may differ from `plan`). */
  plan_preference?: BrandPlanFacts;
  /** Confirmed plan after payment UI submit. */
  plan?: BrandPlanFacts;
  /** Payment UI / future billing markers — never used to block /app access. */
  payment?: BrandPaymentFacts;
  /** Awaiting owner yes/no (or a corrected URL) for a discovered destination link. */
  pending_destination_link?: PendingDestinationLink | null;
}

/**
 * Brand visual tokens — colours, type, logo, aesthetic notes, photo treatment.
 * Not a frozen template theme pack; the design composer (Phase C) reads these
 * plus design-memory refs to compose on-brand creatives.
 */
export interface VisualProfile {
  /** Brand palette as hex (#RRGGBB) or named CSS colours, primary first. */
  colors?: string[];
  /** Preferred typeface names / families (notes for composer; renderer maps to embeds). */
  fonts?: string[];
  /** Absolute URL of the brand logo when known. */
  logo_url?: string;
  /** Short aesthetic label, e.g. "warm minimal", "bold editorial". */
  aesthetic?: string;
  /** Free-form design notes the owner or research added. */
  aesthetic_notes?: string;
  /** How photos should be treated: lighting, grade, crop bias, etc. */
  photo_treatment?: string;
  aspect_ratio?: string;
  /**
   * Default creative surface for drafts when the owner hasn't overridden per-ask.
   * photo = stock/AI photography (Kip's default assumption);
   * designed = typographic text cards / tip slides.
   */
  preferred_visuals?: "photo" | "designed";
}

/** Ideal customer profile — segments, demographics, jobs-to-be-done. */
export interface BrandIcp {
  segments?: string[];
  demographics?: string;
  jtbd?: string[];
  notes?: string;
  /** True when proposed from research rather than owner-authored. */
  researched?: boolean;
  confirmed_at?: string;
  updated_at?: string;
}

export interface PainPoint {
  text: string;
  source?: "research" | "owner";
  confirmed?: boolean;
}

export interface BrandPainPoints {
  items?: PainPoint[];
  updated_at?: string;
}

/** Positioning statement — category + differentiation. */
export interface BrandPositioning {
  one_liner?: string;
  category?: string;
  differentiation?: string;
  updated_at?: string;
}

/**
 * Offer stack. Downstream caption/ad copy must never invent discounts,
 * awards, or testimonials that are not listed here or in BusinessFacts.
 */
export interface BrandOffers {
  primary?: string;
  bonuses?: string[];
  proof?: string[];
  cta?: string;
  booking_link?: string;
  /** Explicit claim constraints, e.g. "no % off unless stated", "no awards". */
  claim_constraints?: string[];
  updated_at?: string;
}

export type DesignMemoryKind = "creative" | "carousel_slide" | "story" | "quote_card";
export type DesignMemoryStatus = "approved" | "published" | "top";

/** Reference to an approved/published creative for design-memory retrieval. */
export interface DesignMemoryRef {
  id: string;
  brand_id: string;
  media_id: string | null;
  post_id: string | null;
  kind: DesignMemoryKind;
  status: DesignMemoryStatus;
  notes: string | null;
  score: number | null;
  created_at: string;
}

export type InteractionKind = "comment" | "dm" | "mention" | "review";
export type InteractionBucket = "lead" | "support" | "general" | "spam";
export type InteractionStatus = "new" | "triaging" | "auto_replied" | "drafted" | "escalated" | "resolved" | "hidden";

export interface Interaction {
  id: string;
  brand_id: string;
  platform: string;
  kind: InteractionKind;
  external_id: string | null;
  author: string | null;
  text: string | null;
  sentiment: string | null;
  bucket: InteractionBucket | null;
  status: InteractionStatus;
  /** Public permalink when the platform provided one. */
  permalink?: string | null;
  /** Kip post this interaction relates to, when known. */
  post_id?: string | null;
  /** Platform media id (e.g. IG media the comment was on). */
  media_external_id?: string | null;
  /** One-shot destination-link private reply / DM ledger. */
  link_fulfillment?: LinkFulfillment | null;
  created_at: string;
}

export interface InteractionReply {
  id: string;
  interaction_id: string;
  brand_id: string;
  body: string;
  actor: "agent" | "owner";
  status: "draft" | "sent";
  external_reply_id: string | null;
  created_at: string;
}

export interface CampaignPlanItem {
  day: number; // day offset from campaign start
  angle: string; // the theme/angle of this post
  caption: string;
  card: string; // punchy line for the generated card image
}

export interface Campaign {
  id: string;
  brand_id: string;
  name: string;
  goal: string | null;
  status: "proposed" | "active" | "paused" | "done" | "cancelled";
  plan: CampaignPlanItem[];
  pause_pillars: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

// Optional pinned posting slot on a pillar. {} / mode 'flex' means no pin —
// the scheduler shuffles windows. A weekly/monthly pin holds an exact day+time.
export const schedulePinSchema = z.object({
  mode: z.enum(["flex", "weekly", "monthly"]).default("flex"),
  // JS getDay() numbering: 0=Sunday … 6=Saturday.
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  // Days of month: 1–31.
  monthDays: z.array(z.number().int().min(1).max(31)).default([]),
  hour: z.number().int().min(0).max(23).default(11),
  minute: z.number().int().min(0).max(59).default(0),
});
export type SchedulePin = z.infer<typeof schedulePinSchema>;

export const emptySchedulePin = (): SchedulePin => schedulePinSchema.parse({});

export interface Pillar {
  id: string;
  brand_id: string;
  key: string;
  name: string;
  description: string;
  posts_per_week: number;
  autopilot: boolean;
  sort: number;
  schedule_pin: SchedulePin;
  /** Preferred format for this pillar when set by an accepted content plan. */
  format_bias?: PostFormat | null;
  last_gap_ping_at: string | null;
  created_at: string;
}

export interface StrategyNote {
  id: string;
  brand_id: string;
  voice_notes: string | null;
  posting_cadence: string | null;
  best_times: Record<string, unknown>;
  content_mix: Record<string, unknown>;
  last_updated: string;
}

export interface ProactiveTrigger {
  id: string;
  brand_id: string;
  kind: TriggerKind;
  schedule: string;
  template_id: string | null;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
}

export interface ApprovalLogEntry {
  id: string;
  post_id: string | null;
  brand_id: string;
  action: ApprovalAction;
  actor: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  created_at: string;
}

export interface Correction {
  id: string;
  brand_id: string;
  post_id: string | null;
  before_caption: string | null;
  after_caption: string | null;
  created_at: string;
}
