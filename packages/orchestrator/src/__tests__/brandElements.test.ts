import { describe, expect, it } from "vitest";
import {
  FEED_ELEMENTS_INSTRUCTION,
  formatBrandKitLine,
  formatMarketVisualsLine,
  resolveFeedElementsIntent,
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

describe("formatBrandKitLine", () => {
  it("surfaces logo presence without inventing a niche template", () => {
    expect(formatBrandKitLine({})).toBe("Brand kit: logo no");
    expect(
      formatBrandKitLine({
        colors: ["#111"],
        fonts: ["Inter"],
        logo_url: "https://example.com/logo.png",
        aesthetic: "warm minimal",
      }),
    ).toBe("Brand kit: colours #111; fonts Inter; logo yes; look warm minimal");
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
    expect(FEED_ELEMENTS_INSTRUCTION).not.toMatch(/if niche is caf[eé]/i);
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
