import { describe, expect, it } from "vitest";
import {
  FEED_ELEMENTS_INSTRUCTION,
  brandVisualLane,
  constructedWantsPhoto,
  formatBrandKitLine,
  formatMarketVisualsLine,
  parseDecoPieces,
  resolveBrandDecoKit,
  resolveFeedDecoIntent,
  resolveFeedElementsIntent,
  suggestDecoPieces,
} from "../brandElements.js";

describe("resolveFeedElementsIntent", () => {
  it("defaults to none so scraped logos are not auto-stamped", () => {
    expect(resolveFeedElementsIntent({})).toBe("none");
    expect(resolveFeedElementsIntent({ brief: "Draft Saturday's bun" })).toBe("none");
  });

  it("honours elements none / mark / constructed", () => {
    expect(resolveFeedElementsIntent({ elements: "none" })).toBe("none");
    expect(resolveFeedElementsIntent({ elements: "mark" })).toBe("mark");
    expect(resolveFeedElementsIntent({ elements: "constructed" })).toBe("constructed");
  });

  it("honours brief directives", () => {
    expect(resolveFeedElementsIntent({ brief: "elements:constructed" })).toBe("constructed");
    expect(resolveFeedElementsIntent({ brief: "stamp the logo on this" })).toBe("mark");
    expect(resolveFeedElementsIntent({ brief: "never stamp logo, keep photos clean" })).toBe("none");
  });
});

describe("constructedWantsPhoto", () => {
  it("defaults constructed to a photo unless the brief is graphics-only", () => {
    expect(constructedWantsPhoto("constructed graphics, black and cream")).toBe(true);
    expect(constructedWantsPhoto("quote cards only")).toBe(false);
    expect(constructedWantsPhoto("graphics only")).toBe(false);
  });
});

describe("formatBrandKitLine", () => {
  it("surfaces logo presence without inventing a niche template", () => {
    expect(formatBrandKitLine({})).toBe("Brand kit: logo no; lane minimal");
    expect(
      formatBrandKitLine({
        colors: ["#111"],
        fonts: ["Inter"],
        logo_url: "https://example.com/logo.png",
        aesthetic: "warm minimal",
      }),
    ).toBe("Brand kit: colours #111; fonts Inter; logo yes; look warm minimal; lane minimal");
  });
});

describe("formatMarketVisualsLine", () => {
  it("joins exemplar labels for the pack", () => {
    expect(
      formatMarketVisualsLine([
        { competitor_name: "Acme", label: "type + logo carousel" },
        { label: "niche quote cards" },
      ]),
    ).toBe("Market visuals: Acme — type + logo carousel; niche quote cards");
    expect(formatMarketVisualsLine([])).toBeNull();
  });
});

describe("FEED_ELEMENTS_INSTRUCTION", () => {
  it("does not encode a café template table", () => {
    expect(FEED_ELEMENTS_INSTRUCTION).toMatch(/Do not map a niche to a template/i);
    expect(FEED_ELEMENTS_INSTRUCTION).toMatch(/OPTIONAL and PER POST/i);
    expect(FEED_ELEMENTS_INSTRUCTION).not.toMatch(/if niche is caf[eé]/i);
  });
});

describe("brandVisualLane", () => {
  it("maps tokens, not a café vs tech table", () => {
    expect(brandVisualLane({ fonts: ["Playfair Display"] })).toBe("editorial");
    expect(brandVisualLane({ fonts: ["Anton"] })).toBe("graphic");
    expect(brandVisualLane({ fonts: ["Inter"] })).toBe("minimal");
    expect(brandVisualLane({ aesthetic: "utilitarian technical" })).toBe("industrial");
    expect(brandVisualLane({})).toBe("minimal");
    expect(brandVisualLane({ colors: ["#141414", "#f5f0e8"] })).toBe("industrial");
  });
});

describe("resolveBrandDecoKit", () => {
  it("skips decoration when no pieces are chosen", () => {
    expect(resolveBrandDecoKit({ fonts: ["Anton"] }, "none")).toBeNull();
    expect(resolveBrandDecoKit({ fonts: ["Anton"] }, "constructed")).toBeNull();
    expect(resolveBrandDecoKit({ fonts: ["Anton"] }, [])).toBeNull();
  });

  it("paints the requested pieces and repeats the same list", () => {
    const framed = resolveBrandDecoKit({ fonts: ["Inter"] }, ["frame", "sticker"]);
    expect(framed?.pieces).toEqual(["frame", "sticker"]);
    expect(framed?.mark).toBe("wordmark");
    expect(resolveBrandDecoKit({ fonts: ["Inter"] }, ["frame", "sticker"])).toEqual(framed);
    expect(resolveBrandDecoKit({ fonts: ["Anton"] }, ["bar", "badge"])?.mark).toBe("badge");
  });

  it("does not encode café=frame or tech=badge", () => {
    const src = `${FEED_ELEMENTS_INSTRUCTION} café bun`;
    expect(src).not.toMatch(/if niche is caf[eé].*frame/i);
  });
});

describe("resolveFeedDecoIntent", () => {
  it("defaults photos clean", () => {
    expect(resolveFeedDecoIntent({})).toEqual([]);
    expect(resolveFeedDecoIntent({ brief: "Draft Saturday's bun" })).toEqual([]);
  });

  it("honours named pieces on the still or in the brief", () => {
    expect(resolveFeedDecoIntent({ deco: ["frame", "badge"] })).toEqual(["frame", "badge"]);
    expect(resolveFeedDecoIntent({ brief: "Add a sticker and a colour bar on this one" })).toEqual([
      "bar",
      "sticker",
    ]);
    expect(resolveFeedDecoIntent({ brief: "keep photos clean, no decoration" })).toEqual([]);
  });

  it("suggests a wider-than-corners set only when asked to decorate without naming pieces", () => {
    const suggested = resolveFeedDecoIntent({
      brief: "Decorate this still",
      visual: { fonts: ["Inter"], aesthetic: "warm minimal" },
    });
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested).not.toEqual(["corners"]);
    expect(suggestDecoPieces({ fonts: ["Anton"] })).toContain("sticker");
    expect(suggestDecoPieces({ fonts: ["Anton"] })).not.toEqual(["corners"]);
  });
});

describe("parseDecoPieces", () => {
  it("caps and dedupes the vocabulary", () => {
    expect(parseDecoPieces(["frame", "frame", "nope", "underline"])).toEqual(["frame", "underline"]);
  });
});

describe("compositeBrandLogo", () => {
  it("keeps the canvas size when stamping a mark", async () => {
    const sharp = (await import("sharp")).default;
    const { compositeBrandLogo } = await import("../imaging.js");
    const base = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#222222" },
    })
      .jpeg()
      .toBuffer();
    const logo = await sharp({
      create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const out = await compositeBrandLogo(base, logo);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });
});

describe("compositeBrandWordmark", () => {
  it("keeps the canvas size when stamping a wordmark", async () => {
    const sharp = (await import("sharp")).default;
    const { compositeBrandWordmark } = await import("../imaging.js");
    const base = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#222222" },
    })
      .jpeg()
      .toBuffer();
    const out = await compositeBrandWordmark(base, "FORGE OPS", { fonts: ["Anton"], colors: ["#111111", "#f5f0e8"] });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });
});

describe("compositeBrandDecoration", () => {
  it("paints kit pieces without changing canvas size", async () => {
    const sharp = (await import("sharp")).default;
    const { compositeBrandDecoration } = await import("../brandDecoration.js");
    const base = await sharp({
      create: { width: 240, height: 240, channels: 3, background: "#445566" },
    })
      .jpeg()
      .toBuffer();
    const out = await compositeBrandDecoration(
      base,
      { lane: "graphic", pieces: ["bar", "sticker", "underline"], mark: "badge" },
      { stroke: "#f5f0e8", fill: "#c8c0b4", accent: "#111111" },
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(240);
  });
});
