import { describe, expect, it } from "vitest";
import {
  detectBrandContextKind,
  looksLikeBrandContextUpdate,
  mergeIcp,
  mergeOffers,
  mergePainPoints,
  mergePositioning,
  mergeVisual,
  brandContextForPrompt,
} from "../brandContext.js";
import { resolveBrandPalette } from "../imaging.js";
import { extractVisualHintsFromHtml } from "../onboarding.js";
import { looksLikeBusinessFact, factsForPrompt } from "../businessProfile.js";
import type { Brand } from "@pulse/shared";

describe("detectBrandContextKind / looksLikeBrandContextUpdate", () => {
  it("detects offer updates", () => {
    expect(detectBrandContextKind("our offer is a free discovery call")).toBe("offers");
    expect(detectBrandContextKind("update our offer — now includes a bonus audit")).toBe("offers");
    expect(looksLikeBrandContextUpdate("our offer is …")).toBe(true);
  });

  it("detects ICP updates", () => {
    expect(detectBrandContextKind("update our ICP — busy cafe owners")).toBe("icp");
    expect(detectBrandContextKind("our ideal customer is local mums")).toBe("icp");
  });

  it("detects positioning, pains, and visual", () => {
    expect(detectBrandContextKind("our positioning is the calm cafe")).toBe("positioning");
    expect(detectBrandContextKind("pain points: no time to post")).toBe("pains");
    expect(detectBrandContextKind("our colours are navy and cream")).toBe("visual");
    expect(detectBrandContextKind("update our brand look — bold sans")).toBe("visual");
  });

  it("returns null for unrelated chatter", () => {
    expect(detectBrandContextKind("can you make the caption shorter?")).toBeNull();
    expect(looksLikeBrandContextUpdate("yes")).toBe(false);
  });
});

describe("merge helpers", () => {
  it("merges ICP fields and stamps updated_at", () => {
    const merged = mergeIcp({ segments: ["a"] }, { demographics: "25-40", jtbd: ["save time"] });
    expect(merged.segments).toEqual(["a"]);
    expect(merged.demographics).toBe("25-40");
    expect(merged.jtbd).toEqual(["save time"]);
    expect(merged.updated_at).toBeTruthy();
  });

  it("merges pain points by text key", () => {
    const merged = mergePainPoints(
      { items: [{ text: "No time", source: "research", confirmed: false }] },
      { items: [{ text: "no time", source: "owner", confirmed: true }, { text: "Confused by ads" }] },
    );
    expect(merged.items).toHaveLength(2);
    const noTime = merged.items!.find((p) => /no time/i.test(p.text))!;
    expect(noTime.confirmed).toBe(true);
    expect(noTime.source).toBe("owner");
  });

  it("merges offers without inventing fields", () => {
    const merged = mergeOffers(
      { primary: "Free consult", claim_constraints: ["no fake awards"] },
      { bonuses: ["PDF guide"], cta: "Book now" },
    );
    expect(merged.primary).toBe("Free consult");
    expect(merged.bonuses).toEqual(["PDF guide"]);
    expect(merged.cta).toBe("Book now");
    expect(merged.claim_constraints).toEqual(["no fake awards"]);
  });

  it("merges positioning and visual", () => {
    expect(mergePositioning({}, { one_liner: "The calm corner cafe" }).one_liner).toBe(
      "The calm corner cafe",
    );
    const visual = mergeVisual({ colors: ["#111"] }, { fonts: ["Playfair"], aesthetic: "warm" });
    expect(visual.colors).toEqual(["#111"]);
    expect(visual.fonts).toEqual(["Playfair"]);
    expect(visual.aesthetic).toBe("warm");
  });
});

describe("brandContextForPrompt", () => {
  it("omits empty sections and includes claim constraints", () => {
    const brand = {
      name: "Test",
      icp: {},
      pain_points: { items: [] },
      positioning: {},
      offers: {
        primary: "Free trial",
        claim_constraints: ["never invent discounts"],
      },
    } as unknown as Brand;
    const text = brandContextForPrompt(brand);
    expect(text).toContain("Free trial");
    expect(text).toContain("never invent discounts");
    expect(text).not.toContain("ICP");
  });

  it("includes confirmed pains and ICP when present", () => {
    const brand = {
      name: "Test",
      icp: { segments: ["cafe owners"], jtbd: ["get regulars posting"] },
      pain_points: {
        items: [
          { text: "No time", confirmed: true },
          { text: "Skip me", confirmed: false },
        ],
      },
      positioning: { one_liner: "Social that runs itself" },
      offers: {},
    } as unknown as Brand;
    const text = brandContextForPrompt(brand);
    expect(text).toContain("cafe owners");
    expect(text).toContain("No time");
    expect(text).not.toContain("Skip me");
    expect(text).toContain("Social that runs itself");
  });
});

describe("resolveBrandPalette", () => {
  it("defaults to dark when visual is empty", () => {
    const p = resolveBrandPalette({});
    expect(p.bgFrom).toBe("#141414");
    expect(p.text).toBe("#ffffff");
  });

  it("uses brand colours and contrast text", () => {
    const p = resolveBrandPalette({ colors: ["#f5f0e8", "#1a3a2a"] });
    expect(p.bgFrom).toBe("#f5f0e8");
    expect(p.bgTo).toBe("#1a3a2a");
    expect(p.text).toBe("#1a1a1a");
  });

  it("maps serif font preference to Playfair", () => {
    const p = resolveBrandPalette({ fonts: ["Playfair Display"] });
    expect(p.displayFont).toBe("Playfair");
    expect(p.bodyFont).toBe("Playfair");
  });
});

describe("extractVisualHintsFromHtml", () => {
  it("pulls theme-color and logo candidates", () => {
    const html = `
      <html><head>
        <meta name="theme-color" content="#0b1f3a" />
        <meta property="og:image" content="https://example.com/logo.png" />
      </head>
      <body><img class="site-logo" src="/img/mark.svg" alt="logo" /></body></html>`;
    const hints = extractVisualHintsFromHtml(html, "https://example.com");
    expect(hints.theme_colors).toContain("#0b1f3a");
    expect(hints.logo_url).toMatch(/example\.com/);
  });
});

describe("businessProfile harden", () => {
  it("still detects facts and includes owner in prompt summary", () => {
    expect(looksLikeBusinessFact("we're open till 6 now")).toBe(true);
    expect(looksLikeBusinessFact("service area is Melbourne CBD")).toBe(true);
    expect(factsForPrompt({ owner_name: "Sam", hours: "9-5" })).toContain("Owner: Sam");
  });
});
