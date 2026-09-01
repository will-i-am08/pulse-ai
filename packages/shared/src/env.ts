import { z } from "zod";

// Server-side environment. Validated lazily so importing this module in the
// browser bundle (where only NEXT_PUBLIC_* exist) doesn't throw at import time.
const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  DRAFT_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  FALLBACK_MODEL: z.string().default("claude-sonnet-5"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  OPERATOR_PHONE: z.string().optional(),
  GRAPH_MODE: z.enum(["mock", "live"]).default("mock"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v21.0"),
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
