import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetServerEnvCache } from "@pulse/shared";
import { aiSpendWeekKey } from "../aiSpend.js";

/**
 * Finding 1 — every image generation path used to sit entirely outside the
 * weekly AI spend cap. `routeImageJob` is pure routing despite the name, so
 * `brands.facts.ai_spend` never moved and AI_WEEKLY_SPEND_CAP_USD was, in
 * practice, a video-only cap while the whole image bill went unrecorded.
 *
 * These tests pin that the cap is now both CHECKED and RECORDED on the two
 * paths that spend: generatePhotoImage (fal still chain / Replicate) and
 * editImageForBrand (Replicate Kontext, ~$0.04 per photo, 10 per carousel).
 */

const h = vi.hoisted(() => ({
  falCalls: 0,
  recorded: [] as Array<{ brandId: string; kind: string }>,
  brandFacts: {} as Record<string, unknown>,
}));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => ({ facts: h.brandFacts })),
    getMedia: vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    })),
    putMedia: vi.fn(async () => undefined),
  };
});

vi.mock("../ugc/falClient.js", () => ({
  falConfigured: () => true,
  falGenerateImageRouted: vi.fn(async () => {
    h.falCalls += 1;
    return null; // never return bytes: this test must not exercise real encoding
  }),
}));

vi.mock("../aiSpend.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiSpend.js")>();
  return {
    ...actual,
    recordAiSpend: vi.fn(async (brandId: string, kind: string) => {
      h.recorded.push({ brandId, kind });
      return { week_key: aiSpendWeekKey(), spent_usd: 0 };
    }),
  };
});

const overCap = { ai_spend: { week_key: aiSpendWeekKey(), spent_usd: 9.99 } };
const underCap = { ai_spend: { week_key: aiSpendWeekKey(), spent_usd: 0 } };

const prevEnv = { ...process.env };

describe("image generation respects the weekly AI spend cap (finding 1)", () => {
  beforeEach(() => {
    h.falCalls = 0;
    h.recorded.length = 0;
    h.brandFacts = underCap;
    resetServerEnvCache();
    // The under-cap cases proceed far enough to reach getServerEnv(), which
    // validates the whole schema — so the baseline required vars must be set
    // too, not just the spend ones. (The over-cap cases short-circuit before
    // this, which is why they passed without it.)
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");
    process.env.APP_BASE_URL = process.env.APP_BASE_URL || "https://kip.example";
    process.env.AI_WEEKLY_SPEND_CAP_USD = "10";
    process.env.COST_IMAGE_USD = "0.04";
    process.env.REPLICATE_API_TOKEN = "test-token";
    resetServerEnvCache();
  });

  afterEach(() => {
    process.env = { ...prevEnv };
    resetServerEnvCache();
    vi.clearAllMocks();
  });

  it("refuses to generate once the brand is over the weekly cap", async () => {
    const { generatePhotoImage } = await import("../imaging.js");
    h.brandFacts = overCap;

    const out = await generatePhotoImage("a latte on a bench", "1:1", {
      brand: { id: "brand-1", facts: overCap } as never,
    });

    expect(out).toBeNull();
    // The key assertion: no billable submission was made at all.
    expect(h.falCalls).toBe(0);
    expect(h.recorded).toHaveLength(0);
  });

  it("reads the cap fresh from the DB, not the caller's stale snapshot", async () => {
    const { generatePhotoImage } = await import("../imaging.js");
    // Caller holds a Brand loaded at the top of the request showing $0 spent…
    h.brandFacts = overCap; // …but the DB says the cap is already blown.

    const out = await generatePhotoImage("a latte", "1:1", {
      brand: { id: "brand-1", facts: underCap } as never,
    });

    expect(out).toBeNull();
    expect(h.falCalls).toBe(0);
  });

  it("allows generation under the cap", async () => {
    const { generatePhotoImage } = await import("../imaging.js");
    h.brandFacts = underCap;

    await generatePhotoImage("a latte", "1:1", {
      brand: { id: "brand-1", facts: underCap } as never,
    });

    expect(h.falCalls).toBe(1);
  });

  it("editImageForBrand refuses over the cap and never reaches Replicate", async () => {
    const { editImageForBrand } = await import("../imaging.js");
    h.brandFacts = overCap;

    const out = await editImageForBrand(
      { id: "brand-1", name: "Test", facts: overCap } as never,
      "media-1",
    );

    expect(out).toBeNull();
    expect(h.recorded).toHaveLength(0);
  });

  it("gradePhotoBundle bails before the shared vision call when capped", async () => {
    const { gradePhotoBundle } = await import("../imaging.js");
    h.brandFacts = overCap;
    const ids = Array.from({ length: 10 }, (_, i) => `media-${i}`);

    const out = await gradePhotoBundle(
      { id: "brand-1", name: "Test", facts: overCap } as never,
      ids,
    );

    // Returns the originals untouched rather than firing 10 Kontext edits.
    expect(out).toEqual(ids);
    expect(h.recorded).toHaveLength(0);
  });
});
