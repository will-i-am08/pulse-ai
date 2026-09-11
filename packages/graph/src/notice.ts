import { isMockOnlyPlatform, platformLabel, type Platform } from "@pulse/shared";

/** True when this publish actually hit a live platform API (not the fake feed). */
export function didPublishLive(platform: Platform | string, graphMode: "mock" | "live"): boolean {
  if (isMockOnlyPlatform(platform)) return false;
  return graphMode === "live";
}

export function publishConfirmation(
  platform: Platform | string,
  opts: {
    live: boolean;
    feedUrl: string;
    externalPostId?: string | null;
    permalink?: string | null;
  },
): string {
  const name = platformLabel(platform);
  if (!opts.live || isMockOnlyPlatform(platform)) {
    if (isMockOnlyPlatform(platform)) {
      return `✅ Posted to ${name} (mock — did not go live). See it on the feed: ${opts.feedUrl}`;
    }
    return `✅ Posted to ${name}! See it on the feed: ${opts.feedUrl}`;
  }
  const idBit = opts.externalPostId ? ` — id ${opts.externalPostId}` : "";
  const linkBit = opts.permalink ? `\n${opts.permalink}` : "";
  return `✅ Posted live to ${name}${idBit}${linkBit}`.trim();
}
