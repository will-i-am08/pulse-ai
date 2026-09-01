import { z } from "zod";

// ─── Enums (mirror the DB CHECK constraints) ────────────────
export const MessageDirection = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MessageDirection)[number];

export const MessageType = ["media", "instruction", "approval", "question", "edit", "other"] as const;
export type MessageType = (typeof MessageType)[number];

export const MediaKind = ["photo", "video"] as const;
export type MediaKind = (typeof MediaKind)[number];

export const MediaSource = ["client", "operator"] as const;
export type MediaSource = (typeof MediaSource)[number];

export const Platform = ["instagram", "facebook"] as const;
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
export interface Brand {
  id: string;
  name: string;
  client_phone: string;
  brand_voice_profile: BrandVoiceProfile;
  ig_user_id: string | null;
  fb_page_id: string | null;
  platform_tokens_encrypted: string | null;
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
  created_at: string;
}

export interface Post {
  id: string;
  brand_id: string;
  caption: string | null;
  media_ids: string[];
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
