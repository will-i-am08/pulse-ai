/**
 * Is a platform's app configured on this deployment?
 *
 * Every platform integration in the live adapter follows the same shape:
 *   if (!platformConfigured("<ENV_VAR>") || !brand.<tokens>) → use the mock feed
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
 */
export function platformConfigured(envVar: string): boolean {
  const value = process.env[envVar];
  return typeof value === "string" && value.length > 0;
}
