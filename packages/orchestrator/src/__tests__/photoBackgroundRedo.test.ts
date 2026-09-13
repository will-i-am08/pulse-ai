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

  it("returns null instead of a quote card when photo generation fails", async () => {
    const { generateFillerPost } = await import("../fillers.js");
    const { generatePhotoImage, renderQuoteCard } = await import("../imaging.js");
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
    const out = await generateFillerPost(brand, pillar, { visuals: "photo" });
    expect(out).toBeNull();
    expect(generatePhotoImage).toHaveBeenCalled();
    expect(renderQuoteCard).not.toHaveBeenCalled();
  });
});
