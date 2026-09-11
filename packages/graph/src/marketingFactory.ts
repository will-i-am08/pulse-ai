import { getServerEnv } from "@pulse/shared";
import type { MarketingAdapter } from "./marketingTypes.js";
import { MockMarketingAdapter } from "./marketingMock.js";
import { LiveMarketingAdapter } from "./marketingLive.js";

let cached: MarketingAdapter | null = null;

export function getMarketingAdapter(): MarketingAdapter {
  if (cached) return cached;
  cached = getServerEnv().GRAPH_MODE === "live" ? new LiveMarketingAdapter() : new MockMarketingAdapter();
  return cached;
}

export function resetMarketingAdapterCache(): void { cached = null; }
