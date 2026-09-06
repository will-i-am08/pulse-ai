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

export const Platform = ["instagram", "facebook", "google"] as const;
export type Platform = (typeof Platform)[number];

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
export const brandVoiceProfileSchema = z.object({
  tone: z.array(z.string()).default([]),          // e.g. ["warm", "playful", "concise"]
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
  example_captions: z.array(z.string()).default([]),
  banned_words: z.array(z.string()).default([]),
  emoji_policy: z.enum(["none", "sparing", "liberal"]).default("sparing"),
  hashtag_policy: z.string().default(""),
  notes: z.array(z.string()).default([]),         // rolling learned notes from corrections
});
export type BrandVoiceProfile = z.infer<typeof brandVoiceProfileSchema>;

export const emptyBrandVoiceProfile = (): BrandVoiceProfile =>
  brandVoiceProfileSchema.parse({});

// ─── Row shapes (mirror the tables in 0001_init.sql) ────────
export type AccountType = "business" | "personal";

export type OnboardingStatus = "none" | "pending" | "in_progress" | "done";

export interface OnboardingTurnMsg {
  role: "user" | "assistant";
  content: string;
}

export interface OnboardingState {
  status: OnboardingStatus;
  step?: number;
  turns?: number;
  type?: AccountType;
  transcript?: OnboardingTurnMsg[];
  answers?: Record<string, string>;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  password_hash?: string;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  client_phone: string;
  discord_channel_id: string | null;
  discord_user_id: string | null;
  owner_user_id: string | null;
  account_type: AccountType | null;
  website: string | null;
  onboarding_state: OnboardingState;
  brand_voice_profile: BrandVoiceProfile;
  ig_user_id: string | null;
  fb_page_id: string | null;
  fb_page_name: string | null;
  ig_username: string | null;
  platform_tokens_encrypted: string | null;
  platform_user_token_encrypted: string | null;
  meta_connected_at: string | null;
  google_tokens_encrypted: string | null;
  gbp_account: string | null;
  gbp_location_id: string | null;
  gbp_location_name: string | null;
  google_connected_at: string | null;
  facts: BusinessFacts;
  visual: VisualProfile;
  approver: Approver;
  status: BrandStatus;
  created_at: string;
  updated_at: string;
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

// A connected photo source the agent polls for new media (Phase C auto-pull).
export const ContentSourceKind = ["google_photos", "google_drive", "dropbox"] as const;
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
  style_meta: { wants_text?: boolean; headline?: string } | null;
  // Content pillar this post belongs to, and autopilot bookkeeping.
  pillar_id: string | null;
  is_auto: boolean;
  hold_notified_at: string | null;
  // When we last nudged the client that this draft is still awaiting their yes
  // (the ~24h chase fires once per post).
  chased_at: string | null;
  campaign_id: string | null;
  platform: Platform;
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

export interface BusinessFacts {
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
}

export interface VisualProfile {
  colors?: string[];
  fonts?: string[];
  aspect_ratio?: string;
  aesthetic?: string;
}

export type InteractionKind = "comment" | "dm" | "mention" | "review";
export type InteractionBucket = "lead" | "support" | "general" | "spam";
export type InteractionStatus = "new" | "auto_replied" | "drafted" | "escalated" | "resolved" | "hidden";

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
  status: "proposed" | "active" | "done" | "cancelled";
  plan: CampaignPlanItem[];
  pause_pillars: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export interface Pillar {
  id: string;
  brand_id: string;
  key: string;
  name: string;
  description: string;
  posts_per_week: number;
  autopilot: boolean;
  sort: number;
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
