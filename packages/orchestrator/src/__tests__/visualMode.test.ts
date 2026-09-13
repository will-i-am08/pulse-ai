import { describe, it, expect } from "vitest";
import {
  inferVisualModeFromText,
  resolveVisualMode,
  visualsPayloadValue,
  looksLikeDesignedVisualsAsk,
  looksLikePhotoVisualsAsk,
  looksLikePhotoBackgroundAsk,
} from "../visualMode.js";

describe("inferVisualModeFromText", () => {
  it("defaults to photo", () => {
    expect(inferVisualModeFromText("draft my first batch")).toBe("photo");
    expect(inferVisualModeFromText("")).toBe("photo");
  });

  it("treats stock/generated/AI asks as photo, not designed", () => {
    expect(
      inferVisualModeFromText(
        "I don't have any photos so can you just do either stock or generated?",
      ),
    ).toBe("photo");
    expect(inferVisualModeFromText("use AI-generated photos")).toBe("photo");
  });

  it("only switches to designed for explicit text-card asks", () => {
    expect(inferVisualModeFromText("make text cards please")).toBe("designed");
    expect(inferVisualModeFromText("designed slides only")).toBe("designed");
    expect(looksLikeDesignedVisualsAsk("I have no photos")).toBe(false);
    expect(looksLikePhotoVisualsAsk("stock photos please")).toBe(true);
  });
});

describe("resolveVisualMode", () => {
  it("honors payload.visuals including stock/generated aliases", () => {
    expect(resolveVisualMode({ visual: {} }, { visuals: "generated" })).toBe("photo");
    expect(resolveVisualMode({ visual: {} }, { visuals: "stock" })).toBe("photo");
    expect(resolveVisualMode({ visual: {} }, { visuals: "designed" })).toBe("designed");
  });

  it("falls back to brand preferred_visuals then photo", () => {
    expect(
      resolveVisualMode({ visual: { preferred_visuals: "designed" } }, {}),
    ).toBe("designed");
    expect(resolveVisualMode({ visual: {} }, {})).toBe("photo");
  });
});

describe("visualsPayloadValue", () => {
  it("preserves stock vs generated wording for the queue", () => {
    expect(visualsPayloadValue("photo", "use stock images")).toBe("stock");
    expect(visualsPayloadValue("photo", "AI generated please")).toBe("generated");
    expect(visualsPayloadValue("photo", "draft posts")).toBe("photo");
    expect(visualsPayloadValue("designed", "text cards")).toBe("designed");
  });
});

describe("looksLikePhotoBackgroundAsk", () => {
  it("catches pictures/photos in the background asks", () => {
    expect(
      looksLikePhotoBackgroundAsk(
        "Could you put pictures in the background of them? All of them",
      ),
    ).toBe(true);
    expect(looksLikePhotoBackgroundAsk("add photo backgrounds to all of these")).toBe(true);
    expect(looksLikePhotoBackgroundAsk("make the caption shorter")).toBe(false);
  });

  it("counts as a photo visuals ask", () => {
    expect(
      looksLikePhotoVisualsAsk("put pictures in the background of them"),
    ).toBe(true);
  });
});
