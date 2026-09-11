import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  analyzePerformance,
  aggregateAdMetrics,
  summarizePaidMetrics,
  type PostPerf,
} from "../insights.js";
import {
  looksLikeDigestRequest,
  looksLikeMakeMore,
  looksLikeAnalystBoost,
  looksLikePerfConfirm,
  isAdsEnabled,
  isAdsConnected,
} from "../performanceActions.js";
import type { Brand } from "@pulse/shared";
import { emptyBrandVoiceProfile } from "@pulse/shared";

function post(over: Partial<PostPerf> & { engagement: Record<string, number> }): PostPerf {
  return {
    id: over.id ?? "p1",
    caption: over.caption ?? "hello",
    pillar_name: over.pillar_name ?? "Product",
    pillar_id: over.pillar_id ?? "pill-1",
    platform: over.platform ?? "instagram",
    format: over.format ?? "feed",
    scheduled_at: over.scheduled_at ?? "2026-09-01T18:00:00.000Z",
    engagement: over.engagement,
  };
}

function brand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Test",
    client_phone: "+61400000000",
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" },
    contact_card_sent_at: null,
    brand_voice_profile: emptyBrandVoiceProfile(),
    voice_guide_md: null,
    voice_analysis_state: { status: "none" },
    ig_user_id: null,
    fb_page_id: null,
    fb_page_name: null,
    ig_username: null,
    platform_tokens_encrypted: null,
    platform_user_token_encrypted: null,
    x_user_id: null,
    x_username: null,
    x_tokens_encrypted: null,
    threads_user_id: null,
    threads_username: null,
    threads_tokens_encrypted: null,
    linkedin_org_id: null,
    linkedin_org_name: null,
    linkedin_tokens_encrypted: null,
    linkedin_connected_at: null,
    tiktok_open_id: null,
    tiktok_display_name: null,
    tiktok_tokens_encrypted: null,
    tiktok_connected_at: null,
    tiktok_privacy_defaults: null,
    meta_connected_at: null,
    facts: {},
    visual: {},
    icp: {},
    pain_points: {},
    positioning: {},
    offers: {},
    features: { ads: false },
    ad_account_id: null,
    ad_account_name: null,
    ads_tokens_encrypted: null,
    ads_connected_at: null,
    ads_spend_caps: { weekly_cents: 50000, campaign_cents: 20000 },
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("E2 analyzePerformance format/pillar/timing", () => {
  it("returns honest insufficient-data message under 3 engaged posts", () => {
    const result = analyzePerformance([
      post({ engagement: { likes: 2 } }),
      post({ engagement: { likes: 1 } }),
    ]);
    expect(result.enoughData).toBe(false);
    expect(result.text).toMatch(/Not enough published posts/);
    expect(result.winners).toEqual([]);
    expect(result.suggestion).toBeNull();
  });

  it("compares formats and emits insight + recommendation + winners", () => {
    const result = analyzePerformance([
      post({ id: "a", format: "carousel", pillar_name: "Tips", engagement: { likes: 40, comments: 5 }, scheduled_at: "2026-09-01T19:00:00Z" }),
      post({ id: "b", format: "carousel", pillar_name: "Tips", engagement: { likes: 35 }, scheduled_at: "2026-09-02T18:30:00Z" }),
      post({ id: "c", format: "feed", pillar_name: "Product", engagement: { likes: 8 }, scheduled_at: "2026-09-03T10:00:00Z" }),
      post({ id: "d", format: "story", pillar_name: "Product", engagement: { likes: 5 }, scheduled_at: "2026-09-04T10:00:00Z" }),
    ]);
    expect(result.enoughData).toBe(true);
    expect(result.insight.length).toBeGreaterThan(10);
    expect(result.recommendation.length).toBeGreaterThan(10);
    expect(result.text).toMatch(/💡/);
    expect(result.text).toMatch(/👉/);
    expect(result.text).toMatch(/Organic winners/);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    expect(result.winners[0]!.id).toBe("a");
    expect(result.suggestion?.kind).toBe("lean_format");
    expect(result.suggestion?.format).toBe("carousel");
    expect(result.text).toMatch(/carousels/i);
    expect(result.text).toMatch(/make more of these|boost this|yes/i);
  });

  it("includes reel in format comparison when data exists", () => {
    const result = analyzePerformance([
      post({ format: "reel", engagement: { likes: 50, comments: 10 }, scheduled_at: "2026-09-01T19:00:00Z" }),
      post({ format: "reel", engagement: { likes: 45 }, scheduled_at: "2026-09-02T20:00:00Z" }),
      post({ format: "feed", engagement: { likes: 6 }, scheduled_at: "2026-09-03T11:00:00Z" }),
    ]);
    expect(result.insight).toMatch(/reel/i);
    expect(result.suggestion?.format).toBe("reel");
  });

  it("falls back to pillar comparison when formats aren't comparable", () => {
    const result = analyzePerformance([
      post({ format: "feed", pillar_name: "Education", engagement: { likes: 30 }, scheduled_at: "2026-09-01T19:00:00Z" }),
      post({ format: "feed", pillar_name: "Education", engagement: { likes: 28 }, scheduled_at: "2026-09-02T18:00:00Z" }),
      post({ format: "feed", pillar_name: "Offers", engagement: { likes: 4 }, scheduled_at: "2026-09-03T12:00:00Z" }),
    ]);
    expect(result.insight).toMatch(/Education/);
    expect(result.suggestion?.kind).toBe("lean_pillar");
    expect(result.suggestion?.pillar_name).toBe("Education");
  });

  it("mentions best timing when slots differ", () => {
    const result = analyzePerformance([
      post({ format: "carousel", engagement: { likes: 20 }, scheduled_at: "2026-09-01T19:00:00Z" }),
      post({ format: "carousel", engagement: { likes: 18 }, scheduled_at: "2026-09-02T20:00:00Z" }),
      post({ format: "feed", engagement: { likes: 5 }, scheduled_at: "2026-09-03T09:00:00Z" }),
    ]);
    expect(result.recommendation).toMatch(/evenings|afternoons|mornings|midday/);
  });
});

describe("E4 paid metrics join (graceful)", () => {
  it("aggregates ad metrics and summarizes", () => {
    const paid = aggregateAdMetrics([
      { spend_cents: 2500, impressions: 1000, clicks: 50, leads: 2, ctr: 0.05 },
      { spend_cents: 1500, impressions: 500, clicks: 10, purchases: 1, roas: 2 },
    ]);
    expect(paid).not.toBeNull();
    expect(paid!.spend_cents).toBe(4000);
    expect(paid!.clicks).toBe(60);
    expect(paid!.campaigns).toBe(2);
    const line = summarizePaidMetrics(paid);
    expect(line).toMatch(/spend/i);
    expect(line).toMatch(/CTR/);
  });

  it("omits paid block when ads metrics absent", () => {
    const result = analyzePerformance(
      [
        post({ format: "carousel", engagement: { likes: 20 } }),
        post({ format: "carousel", engagement: { likes: 18 } }),
        post({ format: "feed", engagement: { likes: 5 } }),
      ],
      { paid: null },
    );
    expect(result.text).not.toMatch(/💸/);
  });

  it("includes paid block when metrics provided", () => {
    const result = analyzePerformance(
      [
        post({ format: "carousel", engagement: { likes: 20 } }),
        post({ format: "carousel", engagement: { likes: 18 } }),
        post({ format: "feed", engagement: { likes: 5 } }),
      ],
      { paid: { spend_cents: 5000, ctr: 0.03, roas: 1.8 } },
    );
    expect(result.text).toMatch(/💸/);
    expect(result.text).toMatch(/ROAS|CTR|spend/i);
  });

  it("isAdsEnabled / isAdsConnected are soft checks", () => {
    expect(isAdsEnabled(brand())).toBe(false);
    expect(isAdsEnabled(brand({ features: { ads: true } }))).toBe(true);
    expect(isAdsConnected(brand({ features: { ads: true } }))).toBe(false);
    expect(
      isAdsConnected(
        brand({
          features: { ads: true },
          ad_account_id: "act_1",
          ads_connected_at: new Date().toISOString(),
        }),
      ),
    ).toBe(true);
  });
});

describe("E1 / E3 SMS intent detectors", () => {
  it("detects on-demand digest phrases", () => {
    expect(looksLikeDigestRequest("how did we do this week?")).toBe(true);
    expect(looksLikeDigestRequest("weekly recap please")).toBe(true);
    expect(looksLikeDigestRequest("what's working?")).toBe(true);
    expect(looksLikeDigestRequest("performance digest")).toBe(true);
    expect(looksLikeDigestRequest("post this photo")).toBe(false);
  });

  it("detects make more / boost / confirm", () => {
    expect(looksLikeMakeMore("make more of these")).toBe(true);
    expect(looksLikeMakeMore("lean that way")).toBe(true);
    expect(looksLikeAnalystBoost("boost this")).toBe(true);
    expect(looksLikeAnalystBoost("turn this into a campaign")).toBe(true);
    expect(looksLikeAnalystBoost("promote that")).toBe(true);
    expect(looksLikePerfConfirm("yes")).toBe(true);
    expect(looksLikePerfConfirm("do it")).toBe(true);
    expect(looksLikePerfConfirm("make more of these")).toBe(false);
  });
});

describe("E3 soft boost handoff when ads off", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("texts connect-ads-first and queues recommendation without throwing", async () => {
    const updates: string[] = [];
    vi.doMock("@pulse/shared", async () => {
      const actual = await vi.importActual<typeof import("@pulse/shared")>("@pulse/shared");
      return {
        ...actual,
        query: vi.fn(async (sql: string) => {
          updates.push(sql);
          return [];
        }),
        queryOne: vi.fn(async () => null),
      };
    });
    vi.doMock("../smsConnect.js", () => ({
      connectLinkMessage: () => "Ad account connect isn't live yet — reserved link.",
    }));
    const { handoffBoostOrCampaign, getPerfPending } = await import("../performanceActions.js");
    const b = brand({
      features: { ads: false },
      facts: {
        kip_perf_pending: {
          kind: "lean_format",
          format: "carousel",
          post_id: "winner-1",
          summary: "Lean toward carousels",
          created_at: new Date().toISOString(),
        },
      } as Brand["facts"],
    });
    expect(getPerfPending(b)?.post_id).toBe("winner-1");
    const reply = await handoffBoostOrCampaign(b, { kind: "boost", postId: "winner-1" });
    expect(reply).toMatch(/connect ads first/i);
    expect(reply).toMatch(/reserved link/i);
    expect(updates.some((s) => s.includes("update brands set facts"))).toBe(true);
  });
});

describe("make more of these adjusts bias (suggest confirm)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updates format_bias and reports what changed", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    vi.doMock("@pulse/shared", async () => {
      const actual = await vi.importActual<typeof import("@pulse/shared")>("@pulse/shared");
      return {
        ...actual,
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("update pillars set format_bias")) {
            return [{ id: "p1", name: "Tips" }];
          }
          return [];
        }),
        queryOne: vi.fn(async (sql: string) => {
          if (sql.includes("content_plans")) {
            return {
              id: "plan-1",
              plan: {
                summary: "test",
                pillars: [{ key: "tips", name: "Tips", description: "", posts_per_week: 2, format_bias: "feed" }],
                format_mix: "feed-heavy",
                best_times: "evenings",
                starter_ideas: [],
              },
            };
          }
          if (sql.includes("from pillars")) {
            return {
              id: "pill-1",
              brand_id: "brand-1",
              key: "tips",
              name: "Tips",
              description: "",
              posts_per_week: 2,
              autopilot: false,
              sort: 0,
              format_bias: "feed",
            };
          }
          return null;
        }),
      };
    });
    vi.doMock("../fillers.js", () => ({
      generateFillerPost: vi.fn(async () => null),
    }));
    const { applyMakeMoreOfThese } = await import("../performanceActions.js");
    const b = brand({
      facts: {
        kip_perf_pending: {
          kind: "lean_format",
          format: "carousel",
          summary: "Lean toward carousels",
          created_at: new Date().toISOString(),
        },
      } as Brand["facts"],
    });
    const reply = await applyMakeMoreOfThese(b);
    expect(reply).toMatch(/format bias → carousel|content plan mix toward carousel/i);
    expect(calls.some((c) => c.sql.includes("format_bias"))).toBe(true);
  });
});
