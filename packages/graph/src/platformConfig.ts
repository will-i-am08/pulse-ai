/**
 * Is a platform's app configured on this deployment?
 *
 * Every platform integration in the live adapter follows the same shape:
 *   if (!platformConfigured("<platform|ENV_VAR>") || !brand.<tokens>) → use the mock feed
 *   otherwise → publish for real
 *
 * **Always decide the mock fallback with this helper — never `getServerEnv()`.**
 * `getServerEnv()` validates the *entire* server env and throws when any
 * unrelated var is missing (DATABASE_URL, ANTHROPIC_API_KEY, …). That's fine
 * deep inside a real publish, but the "is this platform even set up?" question
 * must answer cleanly when the platform is NOT configured and the rest of the
 * env may be absent (tests, a half-configured deploy). Reading the one raw env
 * var keeps that decision self-contained.
 *
 * This exists because the same bug shipped twice (X, then Threads) from copying
 * a `getServerEnv().<VAR>` guard. New platforms: copy this, not that.
 *
 * Accepts either a raw env var (`LINKEDIN_CLIENT_ID`) or a platform alias
 * (`linkedin` → LINKEDIN_CLIENT_ID). Brand tokens are still checked at the
 * call site — this helper only answers "is the app credential present?".
 */

const PLATFORM_ENV_ALIAS: Record<string, string> = {
  linkedin: "LINKEDIN_CLIENT_ID",
  tiktok: "TIKTOK_CLIENT_KEY",
  x: "X_CLIENT_ID",
  threads: "THREADS_APP_ID",
};

export function platformConfigured(envVarOrPlatform: string): boolean {
  const envVar = PLATFORM_ENV_ALIAS[envVarOrPlatform.toLowerCase()] ?? envVarOrPlatform;
  const value = process.env[envVar];
  return typeof value === "string" && value.length > 0;
}
