import type { Brand, Platform } from "@pulse/shared";

/**
 * Frozen interface — see docs/BUILD_CONTRACTS.md § C · @pulse/graph.
 * Do not change these signatures; other workstreams code against them.
 */
export interface GraphAdapter {
  publish(input: {
    brand: Brand;
    platform: Platform;
    caption: string;
    mediaUrls: string[];
  }): Promise<{ externalPostId: string; permalink: string | null }>;

  fetchEngagement(
    brand: Brand,
    externalPostId: string,
    platform: Platform
  ): Promise<Record<string, number>>;

  last24hCount(brand: Brand, platform: Platform): Promise<number>;
}
