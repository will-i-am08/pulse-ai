import type { Brand, Platform, PostFormat } from "@pulse/shared";

/**
 * Frozen interface — see docs/BUILD_CONTRACTS.md § C · @pulse/graph.
 * `format` is an additive, optional field (defaults to 'feed'); existing callers
 * are unaffected.
 */
export interface GraphAdapter {
  publish(input: {
    brand: Brand;
    platform: Platform;
    caption: string;
    mediaUrls: string[];
    format?: PostFormat;
  }): Promise<{ externalPostId: string; permalink: string | null }>;

  fetchEngagement(
    brand: Brand,
    externalPostId: string,
    platform: Platform
  ): Promise<Record<string, number>>;

  last24hCount(brand: Brand, platform: Platform): Promise<number>;
}
