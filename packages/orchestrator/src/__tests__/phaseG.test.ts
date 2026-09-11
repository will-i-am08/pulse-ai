import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PostFormat } from "@pulse/shared";
import { weightsFromFormatMix } from "../formats.js";
import {
  looksLikeAiVideoRequest,
  looksLikeMakeReelRequest,
  routeAiVideo,
  aiVideoConfigured,
} from "../aiVideo.js";
import {
  detectFfmpeg,
  resetFfmpegCache,
  validateReelVideo,
  REEL_MAX_BYTES,
  videoEditFallbackSms,
} from "../video.js";

describe("G1 PostFormat reel enum", () => {
  it("includes reel alongside feed/carousel/story", () => {
    expect(PostFormat).toContain("reel");
    expect(PostFormat).toEqual(["feed", "carousel", "story", "reel"]);
  });

  it("parses reel in format_mix weights", () => {
    const w = weightsFromFormatMix("40% carousel, 30% reel, 20% feed, 10% story");
    expect(w).toEqual([
      ["carousel", 40],
      ["reel", 30],
      ["feed", 20],
      ["story", 10],
    ]);
  });
});

describe("G4 AI video / make-reel verbs", () => {
  it("detects generate/AI video requests", () => {
    expect(looksLikeAiVideoRequest("generate a video of latte art")).toBe(true);
    expect(looksLikeAiVideoRequest("generate video please")).toBe(true);
    expect(looksLikeAiVideoRequest("AI video of our shop")).toBe(true);
    expect(looksLikeAiVideoRequest("text-to-video of steam rising")).toBe(true);
    expect(looksLikeAiVideoRequest("make me an ai reel")).toBe(true);
  });

  it("does not treat plain make-a-reel as AI generation", () => {
    expect(looksLikeAiVideoRequest("make a reel")).toBe(false);
    expect(looksLikeAiVideoRequest("make it a reel")).toBe(false);
    expect(looksLikeAiVideoRequest("post this photo")).toBe(false);
  });

  it("detects make-a-reel verbs", () => {
    expect(looksLikeMakeReelRequest("make a reel")).toBe(true);
    expect(looksLikeMakeReelRequest("turn this into a reel")).toBe(true);
    expect(looksLikeMakeReelRequest("reel this")).toBe(true);
    expect(looksLikeMakeReelRequest("make a carousel")).toBe(false);
  });

  it("routeAiVideo returns null when models unset", () => {
    const prevP = process.env.AI_VIDEO_PRIMARY_MODEL;
    const prevS = process.env.AI_VIDEO_SECONDARY_MODEL;
    delete process.env.AI_VIDEO_PRIMARY_MODEL;
    delete process.env.AI_VIDEO_SECONDARY_MODEL;
    expect(routeAiVideo("primary")).toBeNull();
    expect(aiVideoConfigured()).toBe(false);
    if (prevP) process.env.AI_VIDEO_PRIMARY_MODEL = prevP;
    if (prevS) process.env.AI_VIDEO_SECONDARY_MODEL = prevS;
  });

  it("routeAiVideo prefers primary Kling-class model from env", () => {
    process.env.AI_VIDEO_PRIMARY_MODEL = "kwaivgi/kling-v2.1";
    process.env.AI_VIDEO_SECONDARY_MODEL = "runwayml/gen4-turbo";
    const r = routeAiVideo("primary");
    expect(r?.model).toBe("kwaivgi/kling-v2.1");
    expect(r?.tier).toBe("primary");
    const s = routeAiVideo("secondary");
    expect(s?.model).toBe("runwayml/gen4-turbo");
    delete process.env.AI_VIDEO_PRIMARY_MODEL;
    delete process.env.AI_VIDEO_SECONDARY_MODEL;
  });
});

describe("G2/G3 video helpers", () => {
  afterEach(() => {
    resetFfmpegCache();
  });

  it("detects ffmpeg on this environment", async () => {
    const avail = await detectFfmpeg();
    // CI/dev images usually have ffmpeg; assert shape either way.
    expect(typeof avail.ffmpeg).toBe("boolean");
    expect(typeof avail.ffprobe).toBe("boolean");
  });

  it("rejects oversized video with clear SMS", async () => {
    const huge = new Uint8Array(REEL_MAX_BYTES + 1);
    const v = await validateReelVideo(huge, "video/mp4");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sms).toMatch(/too large|100MB/i);
  });

  it("rejects tiny/empty buffers", async () => {
    const v = await validateReelVideo(new Uint8Array(10), "video/mp4");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sms).toMatch(/empty|corrupted/i);
  });

  it("fallback SMS names the brand", () => {
    expect(videoEditFallbackSms("Test Cafe")).toMatch(/Test Cafe/);
    expect(videoEditFallbackSms("Test Cafe")).toMatch(/static/i);
  });
});

describe("G2 draftCaption video path (mocked frames)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../video.js");
    vi.doUnmock("../llm.js");
    vi.doUnmock("@pulse/shared");
  });

  it("attaches extracted frames and asks for a Reel caption", async () => {
    const jpeg = Buffer.from(
      // minimal valid-enough buffer — pushJpegFrame only checks size
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );

    vi.doMock("../video.js", () => ({
      extractVideoFrames: vi.fn(async () => [jpeg, jpeg]),
    }));
    vi.doMock("../llm.js", () => ({
      callLLM: vi.fn(async (opts: { system: string; messages: unknown[] }) => {
        expect(opts.system).toMatch(/REEL/i);
        const user = opts.messages[0] as { content: unknown[] };
        const images = (user.content as Array<{ type: string }>).filter((c) => c.type === "image");
        expect(images.length).toBeGreaterThanOrEqual(1);
        return "Steam rises over a perfect pour.";
      }),
    }));
    vi.doMock("@pulse/shared", async () => {
      const actual = await vi.importActual<typeof import("@pulse/shared")>("@pulse/shared");
      return {
        ...actual,
        queryOne: vi.fn(async (sql: string) => {
          if (sql.includes("from brands")) {
            return {
              id: "b1",
              name: "Test Cafe",
              brand_voice_profile: {},
              facts: {},
              icp: {},
            };
          }
          if (sql.includes("strategy_notes")) return null;
          return null;
        }),
        query: vi.fn(async (sql: string) => {
          if (sql.includes("media_assets")) {
            return [
              {
                id: "v1",
                brand_id: "b1",
                kind: "video",
                content_type: "video/mp4",
                storage_path: "v1",
                source: "client",
              },
            ];
          }
          return [];
        }),
        getMedia: vi.fn(async () => ({
          bytes: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          contentType: "video/mp4",
        })),
        sanitizeChatText: (s: string) => s,
        brandVoiceProfileSchema: actual.brandVoiceProfileSchema,
      };
    });

    const { draftCaption } = await import("../draftCaption.js");
    const result = await draftCaption("b1", ["v1"], { asReel: true });
    expect(result.caption).toMatch(/Steam rises/i);
  });
});
