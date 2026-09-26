import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  looksLikePhotoBackgroundAsk,
  looksLikePhotoVisualsAsk,
} from "../visualMode.js";
import { messageWantsImageEdit } from "../imaging.js";
import { ruleBasedClassify } from "../classify.js";

describe("photo background redo", () => {
  const ask = "Could you put pictures in the background of them? All of them";

  it("detects photo-background asks including 'pictures'", () => {
    expect(looksLikePhotoBackgroundAsk(ask)).toBe(true);
    expect(looksLikePhotoVisualsAsk(ask)).toBe(true);
    expect(looksLikePhotoBackgroundAsk("make it brighter")).toBe(false);
  });

  it("does not treat photo-background asks as Flux image edits", () => {
    expect(messageWantsImageEdit(ask)).toBe(false);
    expect(messageWantsImageEdit("make the background brighter")).toBe(true);
  });

  it("classifies photo-background asks as edit when a draft is pending", () => {
    const r = ruleBasedClassify(ask, false, true);
    expect(r?.classification).toBe("edit");
  });
});

vi.mock("../imaging.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../imaging.js")>();
  return {
    ...actual,
    generatePhotoImage: vi.fn(async () => null),
    renderQuoteCard: vi.fn(async () => Buffer.from("fake-card")),
    generateHeadline: vi.fn(async () => "FALLBACK HEADLINE"),
    applyTextTile: vi.fn(async () => "tiled-media-id"),
    stampBrandLogo: vi.fn(async (_brand, mediaId: string) => mediaId),
  };
});

vi.mock("../briefCompliance.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../briefCompliance.js")>();
  return {
    ...actual,
    reviewBriefCompliance: vi.fn(async () => ({ pass: true, reasons: [], reinforceHint: "" })),
  };
});

vi.mock("../llm.js", () => ({
  callLLM: vi.fn(async () =>
    JSON.stringify({
      caption: "A real caption about hiring",
      photo_prompt: "Founder at a desk reviewing resumes, natural light",
      card: "HIRE FOR SKILL NOT VIBES",
    }),
  ),
}));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    putMedia: vi.fn(async () => undefined),
  };
});

vi.mock("../scheduler.js", () => ({
  scheduleSlot: vi.fn(async () => new Date()),
}));

vi.mock("../mockup.js", () => ({
  previewUrlForPost: vi.fn(async () => "https://example.com/preview.jpg"),
}));

vi.mock("../brandContext.js", () => ({
  brandContextForPrompt: () => "",
}));

vi.mock("../library.js", () => ({
  visualReference: () => "",
}));

describe("generateFillerPost photo mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const brand = {
    id: "b1",
    name: "Bill",
    brand_voice_profile: {},
    visual: {},
  } as any;
  const pillar = {
    id: "p1",
    key: "tips",
    name: "Tips",
    description: "Tips",
    posts_per_week: 3,
  } as any;

  it("returns null instead of a quote card when photo generation fails", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, renderQuoteCard, applyTextTile } = await import("../imaging.js");
    const out = await generateFillerPost(brand, pillar, { visuals: "photo" });
    expect(out).toBeNull();
    expect(generatePhotoImage).toHaveBeenCalled();
    expect(renderQuoteCard).not.toHaveBeenCalled();
    expect(applyTextTile).not.toHaveBeenCalled();
  });

  it("burns card headline onto photo and persists wants_text", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, applyTextTile, generateHeadline } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");
    const { brandOverlayTreatment } = await import("../overlayIntent.js");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-1",
      caption: "A real caption about hiring",
      media_ids: ["tiled-media-id"],
    } as any);

    const out = await generateFillerPost(brand, pillar, { visuals: "photo", overlay: "headline" });
    expect(out).not.toBeNull();
    expect(applyTextTile).toHaveBeenCalledWith(
      brand,
      expect.any(String),
      "HIRE FOR SKILL NOT VIBES",
      expect.objectContaining({
        treatment: brandOverlayTreatment({}, "shouty"),
      }),
    );
    expect(generateHeadline).not.toHaveBeenCalled();

    const insertArgs = vi.mocked(queryOne).mock.calls[0];
    const styleJson = String(insertArgs?.[1]?.[6] ?? "");
    const meta = JSON.parse(styleJson);
    expect(meta.wants_text).toBe(true);
    expect(meta.headline).toBe("HIRE FOR SKILL NOT VIBES");
    expect(insertArgs?.[1]?.[2]).toEqual(["tiled-media-id"]);
    // Clean photo id is preserved so set_image_text(false) can restore it.
    expect(insertArgs?.[1]?.[3]).toEqual([expect.any(String)]);
    expect(insertArgs?.[1]?.[3]?.[0]).not.toBe("tiled-media-id");
  });

  it("does not burn overlay on generated stills by default", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, applyTextTile } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-clean",
      caption: "A real caption about hiring",
      media_ids: ["source-id"],
    } as any);

    const out = await generateFillerPost(brand, pillar, { visuals: "photo" });
    expect(out).not.toBeNull();
    expect(applyTextTile).not.toHaveBeenCalled();
    const insertArgs = vi.mocked(queryOne).mock.calls[0];
    const meta = JSON.parse(String(insertArgs?.[1]?.[6] ?? ""));
    expect(meta.wants_text).toBe(false);
  });

  it("skips tiling when overlay is none even if the LLM wrote a card", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, applyTextTile } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-none",
      caption: "A real caption about hiring",
      media_ids: ["source-id"],
    } as any);

    await generateFillerPost(brand, pillar, { visuals: "photo", overlay: "none" });
    expect(applyTextTile).not.toHaveBeenCalled();
  });

  it("applies quiet treatment when overlay_tone is quiet", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, applyTextTile } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");
    const { brandOverlayTreatment } = await import("../overlayIntent.js");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-quiet",
      caption: "A real caption about hiring",
      media_ids: ["tiled-media-id"],
    } as any);

    await generateFillerPost(brand, pillar, {
      visuals: "photo",
      overlay: "headline",
      overlay_tone: "quiet",
    });
    expect(applyTextTile).toHaveBeenCalledWith(
      brand,
      expect.any(String),
      "HIRE FOR SKILL NOT VIBES",
      expect.objectContaining({ treatment: brandOverlayTreatment({}, "quiet") }),
    );
  });

  it("does not encode a café overlay skip table", async () => {
    const { FEED_OVERLAY_INSTRUCTION } = await import("../overlayIntent.js");
    expect(FEED_OVERLAY_INSTRUCTION).toMatch(/Do not map a niche to overlay/i);
    expect(FEED_OVERLAY_INSTRUCTION).toMatch(/house style/i);
    expect(FEED_OVERLAY_INSTRUCTION).not.toMatch(/caf[eé].*=.*none|tech.*=.*headline/i);
  });

  it("honors explicit destinations even when topicHint dropped LinkedIn", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage } = await import("../imaging.js");
    const { callLLM } = await import("../llm.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(callLLM).mockImplementation(async (opts: { system?: string }) => {
      const sys = String(opts?.system ?? "");
      if (/ruthless brief-compliance|brief-compliance checker/i.test(sys)) {
        return JSON.stringify({ pass: true, reasons: [], reinforce_hint: "" });
      }
      return JSON.stringify({
        caption: "Hiring a barista who can pull consistent shots matters more than vibes.",
        photo_prompt: "Barista steaming milk in a sunlit cafe, natural light",
        card: "HIRE FOR SKILL NOT VIBES",
      });
    });
    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-li",
      caption: "Hiring a barista who can pull consistent shots matters more than vibes.",
      media_ids: ["tiled-media-id"],
      platform: "linkedin",
    } as any);

    try {
      const out = await generateFillerPost(brand, pillar, {
        visuals: "photo",
        topicHint: "hiring barista",
        destinations: ["linkedin"],
      });
      expect(out).not.toBeNull();
      const draftCall = vi
        .mocked(callLLM)
        .mock.calls.find((c) => !/ruthless brief-compliance|brief-compliance checker/i.test(String(c[0]?.system ?? "")));
      expect(String(draftCall?.[0]?.system ?? "")).toMatch(/LinkedIn/i);
      const insertSql = String(vi.mocked(queryOne).mock.calls[0]?.[0] ?? "");
      expect(insertSql).toMatch(/destinations/);
      const insertArgs = vi.mocked(queryOne).mock.calls[0]?.[1] as unknown[];
      expect(insertArgs?.[7]).toBe("linkedin");
      expect(insertArgs?.[8]).toEqual(expect.arrayContaining(["linkedin"]));
    } finally {
      vi.mocked(callLLM).mockImplementation(async () =>
        JSON.stringify({
          caption: "A real caption about hiring",
          photo_prompt: "Founder at a desk reviewing resumes, natural light",
          card: "HIRE FOR SKILL NOT VIBES",
        }),
      );
    }
  });

  it("constructs on a generated photo with type and mark", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, renderQuoteCard, applyTextTile, stampBrandLogo } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-el",
      caption: "A real caption about hiring",
      media_ids: ["marked-media-id"],
    } as any);
    vi.mocked(stampBrandLogo).mockResolvedValueOnce("marked-media-id");

    const out = await generateFillerPost(brand, pillar, { elements: "constructed" });
    expect(out).not.toBeNull();
    expect(generatePhotoImage).toHaveBeenCalled();
    expect(renderQuoteCard).not.toHaveBeenCalled();
    expect(applyTextTile).toHaveBeenCalled();
    expect(stampBrandLogo).toHaveBeenCalled();
    const insertArgs = vi.mocked(queryOne).mock.calls[0];
    const meta = JSON.parse(String(insertArgs?.[1]?.[6] ?? ""));
    expect(meta.brand_elements).toBe("constructed");
    expect(meta.wants_text).toBe(true);
    expect(meta.brand_kit).toMatchObject({ lane: "minimal" });
    expect(stampBrandLogo).toHaveBeenCalledWith(brand, expect.any(String), { elements: "constructed" });
  });

  it("falls back to a palette quote card when constructed is graphics-only", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, renderQuoteCard, stampBrandLogo } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-card",
      caption: "A real caption about hiring",
      media_ids: ["card-id"],
    } as any);

    const out = await generateFillerPost(brand, pillar, {
      elements: "constructed",
      topicHint: "quote cards only, graphics only",
    });
    expect(out).not.toBeNull();
    expect(generatePhotoImage).not.toHaveBeenCalled();
    expect(renderQuoteCard).toHaveBeenCalled();
    expect(stampBrandLogo).not.toHaveBeenCalled();
  });

  it("stamps a brand mark on a photo when elements is mark", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, applyTextTile, stampBrandLogo } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-mark",
      caption: "A real caption about hiring",
      media_ids: ["logo-media-id"],
    } as any);
    vi.mocked(stampBrandLogo).mockResolvedValueOnce("logo-media-id");

    const out = await generateFillerPost(brand, pillar, { visuals: "photo", elements: "mark" });
    expect(out).not.toBeNull();
    expect(applyTextTile).not.toHaveBeenCalled();
    expect(stampBrandLogo).toHaveBeenCalled();
    const insertArgs = vi.mocked(queryOne).mock.calls[0];
    const meta = JSON.parse(String(insertArgs?.[1]?.[6] ?? ""));
    expect(meta.brand_elements).toBe("mark");
  });

  it("does not stamp a logo when elements is none", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, stampBrandLogo } = await import("../imaging.js");
    const { queryOne } = await import("@pulse/shared");

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-none",
      caption: "A real caption about hiring",
      media_ids: ["tiled-media-id"],
    } as any);

    await generateFillerPost(brand, pillar, { visuals: "photo", elements: "none" });
    expect(stampBrandLogo).not.toHaveBeenCalled();
  });

  it("captures interview tokens before stamping when the masthead is empty", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    const inbound = readFileSync(join(here, "../processInbound.ts"), "utf8");
    expect(fillers).toMatch(/captureInterviewVisualTokens/);
    expect(fillers).toMatch(/overlayMasthead\(brand\)/);
    expect(inbound).toMatch(/shouldCaptureInterviewTokens/);
    expect(inbound).toMatch(/captureInterviewVisualTokens/);
    const leftover = inbound.slice(inbound.indexOf("async function leftoverTurn"));
    expect(leftover.indexOf("captureInterviewVisualTokens")).toBeLessThan(leftover.indexOf("runGeneralAgent"));
  });
});

describe("FEED_PHOTO_NEGATIVE", () => {
  it("bans common AI clutter props and on-image typography", async () => {
    const { FEED_PHOTO_NEGATIVE } = await import("../ugc/presets/stillPresets.js");
    expect(FEED_PHOTO_NEGATIVE).toMatch(/water bottle/i);
    expect(FEED_PHOTO_NEGATIVE).toMatch(/laptop/i);
    expect(FEED_PHOTO_NEGATIVE).toMatch(/typography in image/i);
  });

  it("Replicate fallback bakes realism + Avoid negatives into the prompt", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const replicate = imaging.slice(
      imaging.indexOf("async function generatePhotoImageViaReplicate"),
      imaging.indexOf("export async function editImageForBrand"),
    );
    expect(replicate).toMatch(/withFeedPhotoLook/);
    expect(replicate).toMatch(/FEED_PHOTO_NEGATIVE/);
    expect(replicate).toMatch(/Avoid:/);
    expect(replicate).toMatch(/prompt: hardened/);
  });

  it("fal feed path applies withFeedPhotoLook before routing", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const inner = imaging.slice(
      imaging.indexOf("async function generatePhotoImageInner"),
      imaging.indexOf("async function generatePhotoImageViaReplicate"),
    );
    expect(inner).toMatch(/withFeedPhotoLook/);
    expect(inner).toMatch(/FEED_PHOTO_NEGATIVE/);
  });

  it("photo carousel hard-fails AI-slop after full rebuild", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const formats = readFileSync(join(here, "../formats.ts"), "utf8");
    expect(formats).toMatch(/AI-slop|photo looks AI/);
    expect(formats).toMatch(/soft QA remainders after recompose/);
  });
});

describe("extractJsonObject / draftFillerFields", () => {
  it("extracts fenced and bare JSON objects", async () => {
    const { extractJsonObject } = await import("../fillers.js");
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonObject('Here:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("{truncated")).toBeNull();
  });

  it("retries when the first LLM reply is truncated JSON", async () => {
    const { callLLM } = await import("../llm.js");
    const { draftFillerFields } = await import("../fillers.js");
    vi.mocked(callLLM).mockReset();
    vi.mocked(callLLM)
      .mockResolvedValueOnce('{"caption":"cut off mid')
      .mockResolvedValueOnce(
        JSON.stringify({
          caption: "Recovered caption",
          photo_prompt: "Quiet office desk, morning light",
          card: "SHIP THE WORK",
        }),
      );
    const out = await draftFillerFields("system", "Tips", true);
    expect(out).toEqual({
      caption: "Recovered caption",
      card: "SHIP THE WORK",
      photoPrompt: "Quiet office desk, morning light",
    });
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callLLM).mock.calls[0]![0].maxTokens).toBe(700);
  });
});
