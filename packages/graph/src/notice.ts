import { isMockOnlyPlatform, platformLabel, type Platform } from "@pulse/shared";

/** X and Threads never go live, even when GRAPH_MODE=live. */
export function didPublishLive(platform: Platform | string, graphMode: "mock" | "live"): boolean {
  if (isMockOnlyPlatform(platform)) return false;
  return graphMode === "live";
}

export function publishConfirmation(
  platform: Platform | string,
  opts: { live: boolean; feedUrl: string; externalPostId?: string | null },
): string {
  const name = platformLabel(platform);
  if (!opts.live || isMockOnlyPlatform(platform)) {
    if (isMockOnlyPlatform(platform)) {
      return `✅ Posted to ${name} (mock — did not go live). See it on the feed: ${opts.feedUrl}`;
    }
    return `✅ Posted to ${platform}! See it on the feed: ${opts.feedUrl}`;
  }
  return `✅ Posted live to ${name} — id ${opts.externalPostId ?? ""}`.trim();
}
