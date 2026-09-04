import type { Platform } from "@pulse/shared";

/** Meta rate ceilings — enforced here via GraphAdapter.last24hCount (see BUILD_CONTRACTS.md). */
export const RATE_LIMITS: Record<Platform, number> = {
  instagram: 100,
  facebook: 25,
  google: 25,
};

/** After this many failed publish attempts, a post is marked `failed` and the operator is alerted. */
export const MAX_PUBLISH_ATTEMPTS = 4;

/** Exponential backoff base between DB-level publish retries: 2, 4, 8, ... minutes. */
export const PUBLISH_BACKOFF_BASE_MINUTES = 2;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (set it in the worker's environment)`);
  }
  return value;
}

/** The operator's own phone number — target for failure alerts and operator-only triggers. */
export function operatorPhone(): string {
  return requireEnv("OPERATOR_PHONE");
}
