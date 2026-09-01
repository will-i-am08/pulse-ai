import type { GraphAdapter } from "@pulse/graph";
import type { Brand, Platform } from "@pulse/shared";
import { RATE_LIMITS } from "../config.js";

export interface RateLimitCheck {
  ok: boolean;
  count: number;
  limit: number;
}

/**
 * Rate ceilings enforced by the worker using GraphAdapter.last24hCount:
 * Instagram 100/24h, Facebook 25/Page/24h (BUILD_CONTRACTS.md § C · @pulse/graph).
 * Over limit -> caller should skip and leave the post for the next tick.
 */
export async function checkRateLimit(
  adapter: GraphAdapter,
  brand: Brand,
  platform: Platform
): Promise<RateLimitCheck> {
  const limit = RATE_LIMITS[platform];
  const count = await adapter.last24hCount(brand, platform);
  return { ok: count < limit, count, limit };
}
