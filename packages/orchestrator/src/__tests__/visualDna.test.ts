import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Brand } from "@pulse/shared";
import type { DesignContext } from "../designComposer.js";
import { visualDnaPromptLine, type VisualDna } from "../visualDna.js";

vi.mock("../designComposer.js", () => ({
  gatherDesignContext: vi.fn(),
}));

import { gatherDesignContext } from "../designComposer.js";
import { gatherVisualDna } from "../visualDna.js";

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    name: "Test Cafe",
    account_type: "business",
    brand_voice_profile: {
      tone: [],
      dos: [],
      donts: [],
      example_captions: [],
      banned_words: [],
      emoji_policy: "sparing",
      hashtag_policy: "",
      notes: [],
      writing_mechanics: {},
      photo_style: {
        overall_aesthetic: "warm natural",
        lighting: "soft window light",
        composition: "flat lay",
        colour_palette: ["#c4a484"],
        editing: "gentle warmth",
        common_subjects: ["pastries"],
        framing: "overhead",
        recurring_motifs: ["linen"],
      },
      analysis_source: "",
    },
    visual: {
      colors: ["#2b2118", "#f5f0e8"],
      fonts: ["Playfair Display"],
      aesthetic: "warm editorial",
      photo_treatment: "natural, true-to-product",
    },
    facts: {},
    ...over,
  } as Brand;
}

function fakeCtx(brand: Brand, over: Partial<DesignContext> = {}): DesignContext {
  return {
    brand,
    ownMemory: [],
    topMemory: [],
    nicheExemplars: [],
    coldStart: true,
    bootstrapNotes: "COLD-START bootstrap: no design memory yet.",
    ...over,
  };
}

describe("visualDnaPromptLine", () => {
  it("returns a compact Brand visual DNA line from promptBlock", () => {
    const dna: VisualDna = {
      promptBlock: "Aesthetic: warm editorial. Colours: #2b2118. Photo treatment: natural.",
      overlayHints: "palette #2b2118 · fonts Playfair Display",
      coldStart: true,
      faceless: false,
      designContext: fakeCtx(fakeBrand()),
    };
    const line = visualDnaPromptLine(dna);
    expect(line).toMatch(/^Brand visual DNA:/);
    expect(line).toMatch(/warm editorial/);
    expect(line.length).toBeLessThan(300);
  });

  it("returns empty when promptBlock is blank", () => {
    const dna: VisualDna = {
      promptBlock: "",
      overlayHints: "",
      coldStart: false,
      faceless: false,
      designContext: fakeCtx(fakeBrand()),
    };
    expect(visualDnaPromptLine(dna)).toBe("");
  });
});

describe("gatherVisualDna", () => {
  beforeEach(() => {
    vi.mocked(gatherDesignContext).mockReset();
  });

  it("includes brandPhotoStyleBits / visualReference when brand.visual is set", async () => {
    const brand = fakeBrand();
    vi.mocked(gatherDesignContext).mockResolvedValueOnce(fakeCtx(brand));

    const dna = await gatherVisualDna(brand);

    expect(dna.coldStart).toBe(true);
    expect(dna.faceless).toBe(false);
    expect(dna.overlayHints).toMatch(/#2b2118/);
    expect(dna.overlayHints).toMatch(/Playfair Display/);
    expect(dna.promptBlock).toMatch(/warm editorial/);
    expect(dna.promptBlock).toMatch(/natural, true-to-product/);
    expect(dna.promptBlock).toMatch(/soft window light/);
    expect(dna.promptBlock).toMatch(/Match the brand's real aesthetic/i);
    expect(dna.promptBlock.length).toBeLessThanOrEqual(800);
  });

  it("folds faceless lines and memory notes into promptBlock", async () => {
    const brand = fakeBrand({
      facts: { faceless: true, owner_name: "Bill" },
      name: "Bill Calder",
    } as Partial<Brand>);
    vi.mocked(gatherDesignContext).mockResolvedValueOnce(
      fakeCtx(brand, {
        coldStart: false,
        bootstrapNotes: "Own design memory: 1 recent, 1 top.",
        ownMemory: [
          {
            id: "m1",
            brand_id: brand.id,
            media_id: null,
            post_id: null,
            kind: "creative",
            status: "approved",
            notes: "keep linen texture in frame",
            score: 1,
            created_at: new Date().toISOString(),
          },
        ],
        topMemory: [],
      }),
    );

    const dna = await gatherVisualDna(brand);
    expect(dna.faceless).toBe(true);
    expect(dna.coldStart).toBe(false);
    expect(dna.promptBlock).toMatch(/FACELESS|Faceless/i);
    expect(dna.promptBlock).toMatch(/linen texture/i);
  });

  it("lab electrician DNA names the trade and drops leftover café look", async () => {
    const brand = fakeBrand({
      name: "Lab Cafe",
      facts: { lab: true, differentiators: "emergency electrician" },
      visual: {
        colors: ["#111111"],
        fonts: ["Inter"],
        aesthetic: "warm café",
        photo_treatment: "espresso steam",
      },
      brand_voice_profile: {
        photo_style: {
          overall_aesthetic: "coffee shop warmth",
          lighting: "window latte light",
          common_subjects: ["pastries"],
        },
      },
    } as Partial<Brand>);
    vi.mocked(gatherDesignContext).mockResolvedValueOnce(fakeCtx(brand));
    const dna = await gatherVisualDna(brand);
    expect(dna.promptBlock).toMatch(/electrician/i);
    expect(dna.promptBlock).not.toMatch(/Brand: Lab Cafe/i);
    expect(dna.promptBlock).not.toMatch(/warm café/i);
    expect(dna.promptBlock).not.toMatch(/espresso steam/i);
    expect(dna.promptBlock).toMatch(/Never depict a café/i);
  });
});
