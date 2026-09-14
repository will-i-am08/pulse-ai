import { z } from "zod";

// Server-side environment. Validated lazily so importing this module in the
// browser bundle (where only NEXT_PUBLIC_* exist) doesn't throw at import time.
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Operator dashboard auth (single user). AUTH_SECRET signs the session cookie.
  OPERATOR_PASSWORD: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  DRAFT_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  FALLBACK_MODEL: z.string().default("claude-sonnet-5"),
  /** Optional override for smart-tier primary. When unset, smart uses FALLBACK_MODEL. */
  SMART_MODEL: z.string().optional(),
  /**
   * When "true"/"1", callLLM routes by tier (fast/standard/smart).
   * Off by default — tier/task still accepted for logging.
   */
  KIP_SMART_ROUTING: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /**
   * When "true"/"1", question turns use a bounded Anthropic tool loop
   * (brand facts, recent posts, calendar, kickoffs, remember). Off by default.
   */
  KIP_TOOL_LOOP: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /**
   * When "true"/"1", multi-step owner asks get a short SmartPlan before
   * kickoff enqueue (thin planner). Off by default.
   */
  KIP_SMART_PLANNER: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Preferred for sending/media (revocable API key). Signature validation still
  // requires the account Auth Token — an API key secret cannot validate webhooks.
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  OPERATOR_PHONE: z.string().optional(),
  // Messaging channel: Twilio SMS/MMS (primary) or Linq iMessage (end-state).
  MESSAGE_CHANNEL: z.enum(["twilio", "linq"]).default("twilio"),
  // Linq (linqapp.com) iMessage/RCS/SMS sandbox channel.
  LINQ_API_KEY: z.string().optional(),
  LINQ_WEBHOOK_SECRET: z.string().optional(),
  LINQ_TEST_BRAND_ID: z.string().optional(), // first inbound auto-links to this brand
  // Linq sending line (E.164). Required to configure Kip's iMessage contact card
  // (name + profile photo) so recipients see "Kip" instead of a bare number.
  LINQ_FROM_NUMBER: z.string().optional(),
  // Contact card identity shared into iMessage chats (Name and Photo Sharing).
  KIP_CONTACT_FIRST_NAME: z.string().default("Kip"),
  // Public HTTPS image for the contact card. Defaults to APP_BASE_URL + /brand/kip-contact-avatar.png (opaque off-white).
  KIP_CONTACT_IMAGE_URL: z.string().url().optional(),
  // Replicate (AI image editing). If unset, image editing is skipped.
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_IMAGE_MODEL: z.string().default("black-forest-labs/flux-kontext-pro"),
  REPLICATE_TEXT_IMAGE_MODEL: z.string().default("black-forest-labs/flux-schnell"),
  // Optional specialty models (Phase C9). When unset, router falls back to composer.
  REPLICATE_IDEOGRAM_MODEL: z.string().optional(),
  REPLICATE_RECRAFT_MODEL: z.string().optional(),
  // Phase G4 — AI video (Kling primary, Runway secondary). Env-configurable Replicate/fal models.
  // Provider: "replicate" (default) or "fal". Leave models unset to disable AI video gen.
  AI_VIDEO_PROVIDER: z.enum(["replicate", "fal"]).default("replicate"),
  AI_VIDEO_PRIMARY_MODEL: z.string().optional(), // e.g. kwaivgi/kling-v2.1 or fal-ai/kling-video
  AI_VIDEO_SECONDARY_MODEL: z.string().optional(), // e.g. runwayml/gen4-turbo or fal-ai/runway-gen3
  AI_VIDEO_COST_CAP_CENTS_MONTH: z.coerce.number().int().positive().default(2000), // ~$20/brand/mo
  AI_VIDEO_EST_COST_CENTS: z.coerce.number().int().positive().default(50), // estimate per job
  // Soft USD estimates shown in SMS before billable AI jobs (also feed weekly AI spend tracking).
  COST_IMAGE_USD: z.coerce.number().nonnegative().default(0.04),
  COST_VIDEO_USD: z.coerce.number().nonnegative().default(0.5),
  COST_SPECIALTY_USD: z.coerce.number().nonnegative().default(0.12),
  /** Hard weekly cap on AI video/specialty spend per brand (USD). Stored in brands.facts.ai_spend. */
  AI_WEEKLY_SPEND_CAP_USD: z.coerce.number().positive().default(10),
  /** Purge design_memory / research_snapshots older than this many days (worker weekly). */
  RETENTION_DAYS: z.coerce.number().int().min(30).default(180),
  FAL_KEY: z.string().optional(),
  /** UGC still primary: auto | nano_banana | flux_dev | seedream — auto lets Kip pick per brief */
  UGC_STILL_MODEL: z.string().default("auto"),
  /** Comma-separated still fallbacks tried on failure (used when primary is pinned). */
  UGC_STILL_FALLBACKS: z.string().default("flux_dev,seedream"),
  /** UGC motion primary: auto | kling | seedance | wan — auto lets Kip pick per brief */
  UGC_MOTION_MODEL: z.string().default("auto"),
  /** Comma-separated motion fallbacks (used when primary is pinned). */
  UGC_MOTION_FALLBACKS: z.string().default("seedance,wan"),
  /**
   * Voice selection: auto (Kip picks casual_f / casual_m / calm from brief+brand)
   * or fixed (always use ELEVENLABS_VOICE_ID when set).
   */
  UGC_VOICE_MODE: z.string().default("auto"),
  /** Optional fal path overrides (keep swappable without code changes). */
  FAL_NANO_BANANA_MODEL: z.string().default("fal-ai/nano-banana"),
  FAL_FLUX_STILL_MODEL: z.string().default("fal-ai/flux/dev"),
  FAL_SEEDREAM_MODEL: z.string().default("fal-ai/bytedance/seedream/v4/text-to-image"),
  FAL_KLING_I2V_MODEL: z.string().default("fal-ai/kling-video/v2.1/standard/image-to-video"),
  /** ByteDance Seedance — cinematic I2V alternative to Kling. */
  FAL_SEEDANCE_I2V_MODEL: z.string().default("fal-ai/bytedance/seedance/v1/pro/image-to-video"),
  FAL_WAN_I2V_MODEL: z.string().default("fal-ai/wan/v2.1/image-to-video"),
  /** ElevenLabs — conversational UGC voiceover. */
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  /** Raise default UGC job estimate (~$1.50/clip). Soft; monthly cap still applies. */
  UGC_EST_COST_CENTS: z.coerce.number().int().positive().default(150),
  /** Phase-2 talking-head UGC (off until product mode passes sniff tests). */
  UGC_TALKING_HEAD_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  GRAPH_MODE: z.enum(["mock", "live"]).default("mock"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v21.0"),
  // Token Meta echoes back when verifying the webhook subscription.
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // X (Twitter) API v2 — OAuth 2.0 (PKCE). Present = X connect + live posting enabled.
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  // Threads API (Meta) — the "Threads API" use case in the Meta app. Present =
  // Threads connect + live posting enabled.
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  // LinkedIn Marketing Developer Platform — Company Page OAuth + Posts API.
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  // TikTok Content Posting API (Direct Post). Public live also needs TIKTOK_AUDIT_PASSED.
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  /** Set to "true" only after TikTok Content Posting API audit clears. */
  TIKTOK_AUDIT_PASSED: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  TZ: z.string().default("Australia/Sydney"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Validate and return the server environment. Throws with a clear message if misconfigured. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Clear the cached env parse — for tests that mutate process.env between cases. */
export function resetServerEnvCache(): void {
  cached = null;
}
