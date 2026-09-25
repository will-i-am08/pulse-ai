import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand } from "@pulse/shared";
import { query, queryOne } from "@pulse/shared";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

vi.mock("../library.js", () => ({
  bankedPhotoCount: vi.fn(async () => 0),
}));

import { bankedPhotoCount } from "../library.js";
import { rankByKeywordOverlap, retrieveBrandContext } from "../retrieveContext.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedBanked = bankedPhotoCount as unknown as ReturnType<typeof vi.fn>;

function stubBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Sunrise Cafe",
    facts: {
      owner_name: "Sam",
      hours: "7am–3pm",
      kip_preferences: [{ text: "prefer carousels", atISO: "2026-01-01T00:00:00.000Z" }],
    },
    brand_voice_profile: {
      tone: ["warm", "direct"],
      banned_words: ["synergy", "utilize"],
    },
    ig_username: "sunrise",
    visual: {},
    icp: {},
    pain_points: {},
    positioning: {},
    offers: {},
    ...over,
  } as Brand;
}

describe("retrieveBrandContext", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedBanked.mockReset();
    mockedQuery.mockResolvedValue([]);
    mockedQueryOne.mockResolvedValue(null);
    mockedBanked.mockResolvedValue(0);
  });

  it("includes banned words and kip prefs from stub brand even if DB is empty", async () => {
    const pack = await retrieveBrandContext(stubBrand(), "draft a caption");
    expect(pack.text).toMatch(/synergy/);
    expect(pack.text).toMatch(/utilize/);
    expect(pack.text).toMatch(/prefer carousels/);
    expect(mockedQuery).toHaveBeenCalled();
  });

  it("engine status includes library count when bankedPhotoCount returns > 0", async () => {
    mockedBanked.mockResolvedValue(4);
    const pack = await retrieveBrandContext(stubBrand(), "make a carousel");
    expect(pack.text).toMatch(/## Engine/);
    expect(pack.text).toMatch(/4 unused owner photos/i);
    expect(pack.text).toMatch(/from_library/i);
    expect(pack.text).toMatch(/library/i);
    expect(pack.text).toMatch(/Upcoming:/);
    expect(mockedBanked).toHaveBeenCalledWith("brand-1");
  });

  it("engine pack describes offered draft overlay vs caption when pending exists", async () => {
    mockedQueryOne.mockImplementation(async (sql: string) => {
      if (String(sql).includes("pending_approval") && String(sql).includes("select *")) {
        return {
          id: "post-99",
          status: "pending_approval",
          caption: "Six figures on the system compounds.",
          media_ids: ["tiled"],
          source_media_ids: ["source"],
          style_meta: { wants_text: true, headline: "CAR VS ENGINE", generated: true },
          format: "feed",
          platform: "instagram",
          destinations: ["instagram"],
          scheduled_at: null,
        };
      }
      return null;
    });
    const pack = await retrieveBrandContext(stubBrand(), "remove the text");
    expect(pack.text).toMatch(/Offered draft id: post-99/);
    expect(pack.text).toMatch(/Text on image: YES/);
    expect(pack.text).toMatch(/CAR VS ENGINE/);
    expect(pack.text).toMatch(/set_image_text/);
  });

  it("includes open loops and does not dump conversation history", async () => {
    const pack = await retrieveBrandContext(
      stubBrand({
        facts: {
          owner_name: "Sam",
          open_loops: { waiting_on: ["logo colours"], promised: ["first batch"], prefs: [], energy: "steady" },
        },
      }),
      "hello",
    );
    expect(pack.text).toMatch(/## Open loops/);
    expect(pack.text).toMatch(/logo colours/);
    expect(pack.text).not.toMatch(/## Conversation/);
  });

  it("empty sections stay empty-ish (none) and do not invent an ICP", async () => {
    const brand = stubBrand({
      facts: {},
      brand_voice_profile: {} as Brand["brand_voice_profile"],
      icp: {},
      pain_points: {},
      positioning: {},
      offers: {},
    });
    const pack = await retrieveBrandContext(brand, "hello");
    expect(pack.text).toMatch(/\(none\)/);
    expect(pack.text).toMatch(/## Strategy\n\(none\)/);
    expect(pack.text).not.toMatch(/ideal customer/i);
    expect(pack.text).not.toMatch(/ICP \(use when relevant/i);
    expect(pack.text).not.toMatch(/Segments:/);
  });

  it("caps pack chars at 4000", async () => {
    const pack = await retrieveBrandContext(
      stubBrand({ facts: { policies: "x".repeat(12_000) } }),
      "latte special",
    );
    expect(pack.chars).toBeLessThanOrEqual(4000);
    expect(pack.text.length).toBeLessThanOrEqual(4000);
    expect(pack.chars).toBe(pack.text.length);
  });
});

describe("rankByKeywordOverlap", () => {
  it('ranks "Weekend latte special" over "Hiring now" for query "latte special"', () => {
    const ranked = rankByKeywordOverlap(
      "latte special",
      [
        { text: "Hiring now", at: "2026-09-14T00:00:00.000Z" },
        { text: "Weekend latte special", at: "2026-09-01T00:00:00.000Z" },
      ],
      2,
    );
    expect(ranked[0]?.text).toBe("Weekend latte special");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
