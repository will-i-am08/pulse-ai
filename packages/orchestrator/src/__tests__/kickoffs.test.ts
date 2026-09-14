import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

import { query } from "@pulse/shared";
import {
  looksLikeKickoffRequest,
  inferKickoffFromUserMessage,
  inferKickoffFromKipCommit,
  deliverUnstreamed,
  reclaimStaleKickoffs,
  STALE_RUNNING_KICKOFF_MS,
  runKickoffDrain,
} from "../kickoffs.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe("looksLikeKickoffRequest", () => {
  it("catches first-batch / stock / no-photos asks", () => {
    expect(looksLikeKickoffRequest("Can you rerun and draft my first batch")).toBe(true);
    expect(
      looksLikeKickoffRequest(
        "I don't have any photos to send so can you just do either stock or generated?",
      ),
    ).toBe(true);
    expect(looksLikeKickoffRequest("draft me 3 posts")).toBe(true);
  });

  it("treats carousel/photo asks without client media as kickoffs (generate/stock)", () => {
    expect(
      looksLikeKickoffRequest(
        "Can you make me a carrousel with cinematic business photos with text over the top?",
      ),
    ).toBe(true);
    expect(looksLikeKickoffRequest("make me a carousel")).toBe(true);
    expect(looksLikeKickoffRequest("Generate the photos")).toBe(true);
  });

  it("ignores plain chat", () => {
    expect(looksLikeKickoffRequest("thanks!")).toBe(false);
    expect(looksLikeKickoffRequest("what do you think of carousels?")).toBe(false);
  });
});

describe("inferKickoffFromUserMessage", () => {
  it("maps stock/no-photos to first_batch with photo visuals", () => {
    const r = inferKickoffFromUserMessage(
      "I don't have any photos so can you just do stock or generated?",
    );
    expect(r?.kind).toBe("first_batch");
    expect(r?.payload.visuals).toBe("generated");
  });

  it("defaults draft posts to photo visuals", () => {
    const r = inferKickoffFromUserMessage("draft me 2 posts");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.visuals).toBe("photo");
  });

  it("maps cinematic carousel asks to a single photo carousel (not a lone filler)", () => {
    const brief =
      "Can you make me a carrousel with cinematic business photos with text over the top?";
    const r = inferKickoffFromUserMessage(brief);
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.visuals).toBe("photo");
    expect(r?.payload.preferCarousel).toBe(true);
    expect(r?.payload.format).toBe("carousel");
    expect(r?.payload.count).toBe(1);
    expect(r?.payload.topicHint).toBe(brief.slice(0, 280));
    expect(String(r?.ackSms ?? "")).toMatch(/photo carousel/i);
  });


  it("acks idea carousels as researched one-idea-per-slide drafts", () => {
    const brief =
      "Can you make me a carousel with cinematic car photos with text over the top with some business ideas";
    const r = inferKickoffFromUserMessage(brief);
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.preferCarousel).toBe(true);
    expect(r?.payload.format).toBe("carousel");
    expect(String(r?.ackSms ?? "")).toMatch(/researching concrete ideas/i);
    expect(String(r?.ackSms ?? "")).toMatch(/one idea per slide/i);
  });

  it("honors explicit text-card asks as designed", () => {
    const r = inferKickoffFromUserMessage("draft me 2 posts as text cards please");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.visuals).toBe("designed");
  });

  it("maps draft N posts", () => {
    const r = inferKickoffFromUserMessage("draft me 3 posts");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(3);
  });

  it("maps trend draft asks", () => {
    const r = inferKickoffFromUserMessage("draft something on a trending topic for me");
    expect(r?.kind).toBe("trend_draft");
  });
});

describe("inferKickoffFromKipCommit", () => {
  it("queues when Kip promises a first batch", () => {
    const r = inferKickoffFromKipCommit(
      "I don't have photos — use generated",
      "Absolutely, I'll pull together the first batch of carousels and get them over for approval.",
    );
    expect(r?.kind).toBe("first_batch");
    expect(r?.payload.visuals).toBe("generated");
  });

  it("does not queue on pure acknowledgement", () => {
    const r = inferKickoffFromKipCommit("cool", "Nice one, Bill.");
    expect(r).toBeNull();
  });
});

describe("deliverUnstreamed", () => {
  it("calls deliver for empty-batch failure SMS (so Kip does not go silent)", async () => {
    const deliver = vi.fn(async () => {});
    const results = [
      { brandId: "b1", sms: "Couldn't finish those drafts just then — try again in a moment?" },
    ];
    const out = await deliverUnstreamed(results, deliver);
    expect(out).toEqual(results);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(results[0]);
  });

  it("is a no-op when deliver is omitted", async () => {
    const results = [{ brandId: "b1", sms: "Need pillars before I draft." }];
    await expect(deliverUnstreamed(results)).resolves.toEqual(results);
  });
});

describe("reclaimStaleKickoffs", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue([]);
  });

  it("fails running kickoffs older than the stale window and delivers SMS", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: "k1",
        brand_id: "b1",
        kind: "draft_posts",
        status: "failed",
        started_at: "2026-09-14T00:31:05.809Z",
      },
    ]);
    const deliver = vi.fn(async () => {});
    const now = new Date("2026-09-14T00:45:00.000Z");
    const out = await reclaimStaleKickoffs({ now, deliver });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0]!;
    expect(String(sql)).toMatch(/status = 'failed'/);
    expect(String(sql)).toMatch(/abandoned running kickoff/);
    expect(params?.[0]).toBe(
      new Date(now.getTime() - STALE_RUNNING_KICKOFF_MS).toISOString(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.brandId).toBe("b1");
    expect(out[0]?.sms).toMatch(/stuck|stop|retry/i);
    expect(deliver).toHaveBeenCalledWith(out[0]);
  });

  it("returns nothing when no stale running rows exist", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    const deliver = vi.fn(async () => {});
    await expect(reclaimStaleKickoffs({ deliver })).resolves.toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("runKickoffDrain", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("reclaims stale running kickoffs before selecting queued rows", async () => {
    // 1) reclaim query
    mockedQuery.mockResolvedValueOnce([
      {
        id: "stale-1",
        brand_id: "b-stale",
        kind: "draft_posts",
        status: "failed",
      },
    ]);
    // 2) queued select
    mockedQuery.mockResolvedValueOnce([]);
    const deliver = vi.fn(async () => {});
    const out = await runKickoffDrain(2, { deliver });
    expect(mockedQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(mockedQuery.mock.calls[0]![0])).toMatch(/abandoned running kickoff/);
    expect(String(mockedQuery.mock.calls[1]![0])).toMatch(/status = 'queued'/);
    expect(out.some((r) => r.brandId === "b-stale")).toBe(true);
    expect(deliver).toHaveBeenCalled();
  });
});
