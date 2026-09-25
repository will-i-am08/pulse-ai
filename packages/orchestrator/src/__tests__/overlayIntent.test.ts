import { describe, expect, it } from "vitest";
import { QUIET_OVERLAY_TREATMENT, brandOverlayTreatment, overlayExplicitlyOff, resolveFeedOverlayIntent } from "../overlayIntent.js";

describe("resolveFeedOverlayIntent", () => {
  it("defaults generated stills to clean (no always-tile)", () => {
    expect(resolveFeedOverlayIntent({ brief: "Saturday toasted bun special" })).toEqual({
      mode: "none",
      tone: "shouty",
      exactHeadline: null,
    });
  });

  it("honours overlay none and no overlay in the brief", () => {
    expect(resolveFeedOverlayIntent({ overlay: "none" }).mode).toBe("none");
    expect(resolveFeedOverlayIntent({ brief: "Draft a post, no overlay" }).mode).toBe("none");
    expect(resolveFeedOverlayIntent({ brief: "leave the photo clean" }).mode).toBe("none");
  });

  it("honours overlay headline and exact owner lines", () => {
    expect(resolveFeedOverlayIntent({ overlay: "headline" }).mode).toBe("headline");
    const exact = resolveFeedOverlayIntent({
      brief: 'exact overlay headline: WHAT FOUNDER OPS ACTUALLY DOES',
    });
    expect(exact.mode).toBe("headline");
    expect(exact.exactHeadline).toMatch(/FOUNDER OPS/i);
    expect(
      resolveFeedOverlayIntent({ overlay: "headline", overlay_headline: "SATURDAY BUNS" }).exactHeadline,
    ).toBe("SATURDAY BUNS");
  });

  it("reads quiet vs shouty without a niche table", () => {
    expect(resolveFeedOverlayIntent({ overlay: "headline", overlay_tone: "quiet" }).tone).toBe("quiet");
    expect(resolveFeedOverlayIntent({ brief: "overlay:quiet" })).toMatchObject({
      mode: "headline",
      tone: "quiet",
    });
    expect(resolveFeedOverlayIntent({ brief: "overlay:shouty" }).tone).toBe("shouty");
    expect(QUIET_OVERLAY_TREATMENT).toMatchObject({
      placement: "bottom",
      stack: "single",
      face: "inter",
    });
  });

  it("uses brand visual tokens for face so two brands do not share Inter", () => {
    expect(brandOverlayTreatment({ fonts: ["Playfair Display"] }, "shouty").face).toBe("playfair");
    expect(brandOverlayTreatment({ fonts: ["Anton"] }, "shouty").face).toBe("anton");
    expect(brandOverlayTreatment({ fonts: ["Inter"] }, "quiet").face).toBe("inter");
    expect(brandOverlayTreatment({}, "quiet").face).toBe("inter");
    expect(brandOverlayTreatment({}, "shouty").face).toBe("anton");
  });

  it("does not encode café=skip or tech=shout", () => {
    const cafe = resolveFeedOverlayIntent({ brief: "café bun special, natural light" });
    const tech = resolveFeedOverlayIntent({ brief: "SaaS launch announcement" });
    expect(cafe.mode).toBe("none");
    expect(tech.mode).toBe("none");
  });
});

describe("overlayExplicitlyOff", () => {
  it("does not treat the generated-feed default as an explicit off", () => {
    expect(overlayExplicitlyOff({})).toBe(false);
    expect(overlayExplicitlyOff({ brief: "Saturday bun" })).toBe(false);
    expect(overlayExplicitlyOff({ overlay: "none" })).toBe(true);
    expect(overlayExplicitlyOff({ brief: "no overlay on this" })).toBe(true);
  });
});
