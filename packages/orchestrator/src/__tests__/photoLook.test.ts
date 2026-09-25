import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEED_PHOTO_LOOK_INSTRUCTION,
  FEED_PHOTO_REALISM_CUE,
  withFeedPhotoLook,
} from "../ugc/presets/stillPresets.js";
import { PHOTO_EDIT_FAITHFUL_CORE } from "../lookPacks/index.js";

describe("feed photo look", () => {
  it("defaults to shot-on-iPhone, not editorial full-frame", () => {
    expect(FEED_PHOTO_REALISM_CUE).toMatch(/shot on iPhone/i);
    expect(FEED_PHOTO_REALISM_CUE).toMatch(/handheld/i);
    expect(FEED_PHOTO_REALISM_CUE).toMatch(/not studio/i);
    expect(FEED_PHOTO_REALISM_CUE).not.toMatch(/full-frame camera/i);
    expect(FEED_PHOTO_REALISM_CUE).toMatch(/professional or studio look/i);
  });

  it("tells prompt writers not to map niche to look", () => {
    expect(FEED_PHOTO_LOOK_INSTRUCTION).toMatch(/Do not map a niche to a look/i);
    expect(FEED_PHOTO_LOOK_INSTRUCTION).toMatch(/shot on iPhone/i);
  });

  it("withFeedPhotoLook appends the cue once", () => {
    const once = withFeedPhotoLook("a latte on a bench");
    expect(once).toMatch(/latte on a bench/i);
    expect(once).toMatch(/shot on iPhone/i);
    expect(withFeedPhotoLook(once)).toBe(once);
    expect(withFeedPhotoLook("already shot on iPhone, slight grain")).toBe(
      "already shot on iPhone, slight grain",
    );
  });

  it("does not ship a café/tech look table", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const still = readFileSync(join(here, "../ugc/presets/stillPresets.ts"), "utf8");
    expect(still).not.toMatch(/cafe.*=.*iphone|tech.*=.*pro|resolvePhotoLook/i);
  });
});

describe("look-pack polish", () => {
  it("keeps phone grain unless the request asks for pro", () => {
    expect(PHOTO_EDIT_FAITHFUL_CORE).toMatch(/phone-shot character|slight grain|handheld/i);
    expect(PHOTO_EDIT_FAITHFUL_CORE).toMatch(/unless the request or brand photo_style/i);
  });
});
