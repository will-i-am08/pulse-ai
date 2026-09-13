import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { foldCaption, renderFeedMockup, renderStoryMockup } from "../mockup.js";

async function solidPhoto(width = 1200, height = 1600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

const INPUT = {
  brandName: "Pulse Social",
  igUsername: "pulsesocial",
  caption: "Fresh post from the shoot — love how this one turned out!",
  aspectRatio: "4:5",
  slideCount: 3,
};

describe("foldCaption", () => {
  it("passes short captions through untouched", () => {
    expect(foldCaption("Hello world")).toBe("Hello world");
  });

  it("treats null as empty", () => {
    expect(foldCaption(null)).toBe("");
  });

  it("folds long captions at ~125 chars with a more suffix", () => {
    const long =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud.";
    const folded = foldCaption(long);
    expect(folded.length).toBeLessThan(long.length);
    expect(folded.endsWith("… more")).toBe(true);
  });
});

describe("renderFeedMockup", () => {
  it("renders a 1080px-wide JPEG comfortably under 1MB", async () => {
    const photo = await solidPhoto();
    const buf = await renderFeedMockup(new Uint8Array(photo), INPUT);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.length).toBeLessThan(1_000_000);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeGreaterThanOrEqual(1078);
    expect(meta.width).toBeLessThanOrEqual(1082);
  }, 60_000);
});

describe("renderStoryMockup", () => {
  it("renders a 1080x1920 full-bleed story", async () => {
    const photo = await solidPhoto();
    const buf = await renderStoryMockup(new Uint8Array(photo), {
      brandName: "Pulse Social",
      igUsername: "pulsesocial",
      caption: null,
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.length).toBeLessThan(1_000_000);
    const meta = await sharp(buf).metadata();
    expect(Math.abs((meta.width ?? 0) - 1080)).toBeLessThanOrEqual(2);
    expect(Math.abs((meta.height ?? 0) - 1920)).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe("renderFeedMockup composite path", () => {
  it("returns a jpeg without requiring a base64 photo in the SVG path", async () => {
    const { renderFeedMockup } = await import("../mockup.js");
    // 8x8 red png
    const sharp = (await import("sharp")).default;
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    const out = await renderFeedMockup(photo, {
      brandName: "Bill Calder",
      igUsername: "billcalder",
      caption: "Hiring process theater is real.",
      aspectRatio: "1:1",
    });
    expect(out.length).toBeGreaterThan(1000);
    // JPEG magic
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  }, 20000);
});
