import { createHash } from "node:crypto";
import type { Brand, Interaction, Platform, PostFormat } from "@pulse/shared";
import type { GraphAdapter } from "./types.js";
import { withRetry } from "./retry.js";
import { countPublished24h } from "./rateStore.js";

function hashHex(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) so "random" engagement numbers are stable per post. */
function mulberry32(seed: number) {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic stand-in for Meta Graph calls. Used while `GRAPH_MODE=mock` (i.e. before
 * Meta App Review clears, or in dev/CI). Never calls the network.
 */
export class MockGraphAdapter implements GraphAdapter {
  async publish(input: {
    brand: Brand;
    platform: Platform;
    caption: string;
    mediaUrls: string[];
    format?: PostFormat;
    styleMeta?: Record<string, unknown> | null;
  }): Promise<{ externalPostId: string; permalink: string | null }> {
    const { brand, platform, caption, mediaUrls } = input;
    const format: PostFormat = input.format ?? "feed";
    return withRetry(`mock:publish:${brand.id}:${platform}`, async () => {
      const fingerprint = `${brand.id}|${platform}|${format}|${caption}|${mediaUrls.join(",")}|${Date.now()}`;
      const externalPostId = `mock_${hashHex(fingerprint).slice(0, 16)}`;
      const handle =
        platform === "instagram"
          ? brand.ig_user_id
          : platform === "facebook"
            ? brand.fb_page_id
            : platform === "x"
              ? "x"
              : platform === "threads"
                ? "threads"
                : platform === "linkedin"
                  ? brand.linkedin_org_id ?? "linkedin"
                  : platform === "tiktok"
                    ? brand.tiktok_open_id ?? "tiktok"
                    : brand.id;
      const permalink = `https://mock.graph.local/${platform}/${handle ?? brand.id}/${externalPostId}`;
      console.log(
        `[graph:mock] publish brand=${brand.id} platform=${platform} format=${format} media=${mediaUrls.length} -> ${externalPostId}`
      );
      return { externalPostId, permalink };
    });
  }

  async fetchEngagement(
    brand: Brand,
    externalPostId: string,
    platform: Platform
  ): Promise<Record<string, number>> {
    return withRetry(`mock:engagement:${externalPostId}`, async () => {
      const rng = mulberry32(seedFromString(`${externalPostId}:${platform}`));
      const reach = Math.floor(200 + rng() * 4800);
      const likes = Math.floor(reach * (0.02 + rng() * 0.08));
      const comments = Math.floor(likes * (0.02 + rng() * 0.1));
      const saves = platform === "instagram" ? Math.floor(likes * (0.01 + rng() * 0.05)) : 0;
      console.log(
        `[graph:mock] fetchEngagement brand=${brand.id} post=${externalPostId} -> likes=${likes} comments=${comments} reach=${reach}`
      );
      return { likes, comments, reach, saves };
    });
  }

  async last24hCount(brand: Brand, platform: Platform): Promise<number> {
    return withRetry(`mock:last24h:${brand.id}:${platform}`, () => countPublished24h(brand, platform));
  }

  async reply(input: {
    brand: Brand;
    interaction: Interaction;
    body: string;
  }): Promise<{ externalReplyId: string | null }> {
    const { brand, interaction, body } = input;
    return withRetry(`mock:reply:${interaction.id}`, async () => {
      const externalReplyId = `mock_reply_${hashHex(`${interaction.id}|${body}|${Date.now()}`).slice(0, 12)}`;
      console.log(
        `[graph:mock] reply brand=${brand.id} platform=${interaction.platform} kind=${interaction.kind} -> ${externalReplyId}`
      );
      return { externalReplyId };
    });
  }

  async hide(input: { brand: Brand; interaction: Interaction }): Promise<void> {
    const { brand, interaction } = input;
    return withRetry(`mock:hide:${interaction.id}`, async () => {
      console.log(
        `[graph:mock] hide brand=${brand.id} platform=${interaction.platform} kind=${interaction.kind} id=${interaction.external_id ?? interaction.id}`
      );
    });
  }
}
