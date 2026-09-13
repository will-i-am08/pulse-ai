import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []), queryOne: vi.fn(async () => null) };
});
vi.mock("@pulse/graph", () => ({
  harvestBrandPosts: vi.fn(async () => {
    throw new Error("harvest should be skipped on preferFast");
  }),
}));

import { callLLM } from "../llm.js";
import { harvestBrandPosts } from "@pulse/graph";
import {
  buildPlanWithFallback,
  PLAN_WEB_SEARCH_DEEP,
  PLAN_WEB_SEARCH_HYBRID,
} from "../nichePlan.js";
import type { Brand } from "@pulse/shared";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;
const mockedHarvest = harvestBrandPosts as unknown as ReturnType<typeof vi.fn>;

const samplePlan = {
  summary: "3 pillars, 5 posts/wk, carousel-heavy + Reels, best Tue/Thu evenings",
  pillars: [
    {
      key: "tips",
      name: "Tips",
      description: "Actionable founder tips",
      posts_per_week: 2,
      format_bias: "carousel",
    },
    {
      key: "stories",
      name: "Stories",
      description: "Behind-the-scenes",
      posts_per_week: 2,
      format_bias: "story",
    },
    {
      key: "proof",
      name: "Proof",
      description: "Case snippets",
      posts_per_week: 1,
      format_bias: "reel",
    },
  ],
  format_mix: "~70% carousels, ~20% Reels, ~10% stories",
  best_times: "Tue/Thu evenings",
  starter_ideas: ["Checklist carousel", "Mistake reel", "Tool stack"],
};

const brand = {
  id: "b-hybrid",
  name: "Atlas Founder Tips",
  voice_guide_md: "Direct, practical, no fluff.",
  brand_voice_profile: {
    tone: ["direct", "practical"],
    example_captions: ["Ship the checklist. Skip the pep talk."],
    analysis_source: "onboarding",
  },
  ig_user_id: "ig-1",
  platform_tokens_encrypted: "encrypted",
} as unknown as Brand;

beforeEach(() => {
  mockedCallLLM.mockReset();
  mockedHarvest.mockClear();
});

describe("hybrid web×2 onboarding path", () => {
  it("exports hybrid and deep search budgets", () => {
    expect(PLAN_WEB_SEARCH_HYBRID).toBe(2);
    expect(PLAN_WEB_SEARCH_DEEP).toBe(4);
  });

  it("preferFast uses web×2 + skipHarvest + 900 tokens", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify(samplePlan));

    const plan = await buildPlanWithFallback(brand, "AI tips for founders", null, {
      preferFast: true,
    });

    expect(plan?.summary).toContain("carousel");
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const opts = mockedCallLLM.mock.calls[0][0] as {
      webSearch?: number;
      maxTokens?: number;
      system?: string;
    };
    expect(opts.webSearch).toBe(PLAN_WEB_SEARCH_HYBRID);
    expect(opts.maxTokens).toBe(900);
    expect(opts.system).toMatch(/at most 2 focused web searches/i);
    expect(mockedHarvest).not.toHaveBeenCalled();
  });

  it("preferFast falls back to no-web when hybrid fails", async () => {
    mockedCallLLM
      .mockRejectedValueOnce(new Error("web search unavailable"))
      .mockResolvedValueOnce(JSON.stringify(samplePlan));

    const plan = await buildPlanWithFallback(brand, "AI tips for founders", null, {
      preferFast: true,
    });

    expect(plan?.pillars?.length).toBeGreaterThan(0);
    expect(mockedCallLLM).toHaveBeenCalledTimes(2);

    const hybridOpts = mockedCallLLM.mock.calls[0][0] as { webSearch?: number; maxTokens?: number };
    const fallbackOpts = mockedCallLLM.mock.calls[1][0] as { webSearch?: number; maxTokens?: number };
    expect(hybridOpts.webSearch).toBe(2);
    expect(fallbackOpts.webSearch).toBeUndefined();
    expect(fallbackOpts.maxTokens).toBe(900);
    expect(mockedHarvest).not.toHaveBeenCalled();
  });

  it("deep path still uses web×4", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify(samplePlan));

    await buildPlanWithFallback(brand, "AI tips for founders", null);

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const opts = mockedCallLLM.mock.calls[0][0] as { webSearch?: number; maxTokens?: number };
    expect(opts.webSearch).toBe(PLAN_WEB_SEARCH_DEEP);
    expect(opts.maxTokens).toBe(1200);
  });
});
