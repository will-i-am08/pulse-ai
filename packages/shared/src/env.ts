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
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Preferred for sending/media (revocable API key). Signature validation still
  // requires the account Auth Token — an API key secret cannot validate webhooks.
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  OPERATOR_PHONE: z.string().optional(),
  // Messaging channel selection + Discord (interim provider)
  MESSAGE_CHANNEL: z.enum(["twilio", "discord", "linq"]).default("twilio"),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_TEST_BRAND_PHONE: z.string().optional(),
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
