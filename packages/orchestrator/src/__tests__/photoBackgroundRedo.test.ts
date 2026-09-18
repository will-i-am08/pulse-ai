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

    vi.mocked(generatePhotoImage).mockResolvedValueOnce(Buffer.from("fake-photo"));
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "post-1",
      caption: "A real caption about hiring",
      media_ids: ["tiled-media-id"],
    } as any);

    const out = await generateFillerPost(brand, pillar, { visuals: "photo" });
    expect(out).not.toBeNull();
    expect(applyTextTile).toHaveBeenCalledWith(
      brand,
      expect.any(String),
      "HIRE FOR SKILL NOT VIBES",
      undefined,
    );
    expect(generateHeadline).not.toHaveBeenCalled();

    const insertArgs = vi.mocked(queryOne).mock.calls[0];
    const styleJson = String(insertArgs?.[1]?.[5] ?? "");
    const meta = JSON.parse(styleJson);
    expect(meta.wants_text).toBe(true);
    expect(meta.headline).toBe("HIRE FOR SKILL NOT VIBES");
    expect(insertArgs?.[1]?.[2]).toEqual(["tiled-media-id"]);
  });
});

describe("FEED_PHOTO_NEGATIVE", () => {
  it("bans common AI clutter props and on-image typography", async () => {
    const { FEED_PHOTO_NEGATIVE } = await import("../ugc/presets/stillPresets.js");
    expect(FEED_PHOTO_NEGATIVE).toMatch(/water bottle/i);
    expect(FEED_PHOTO_NEGATIVE).toMatch(/laptop/i);
    expect(FEED_PHOTO_NEGATIVE).toMatch(/typography in image/i);
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
