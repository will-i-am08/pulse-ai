import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

import { query, queryOne } from "@pulse/shared";
import {
  looksLikeKickoffRequest,
  looksLikeSlowSmsWork,
  refersToAttachedMedia,
  looksLikeUseThisBrief,
  looksLikeFormatMenuReply,
  looksLikeFormatMenuOutbound,
  looksLikeDraftPreviewOutbound,
  inferKickoffFromUserMessage,
  inferKickoffFromKipCommit,
  deliverUnstreamed,
  reclaimStaleKickoffs,
  STALE_RUNNING_KICKOFF_MS,
  runKickoffDrain,
} from "../kickoffs.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

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

  it("does not treat a bare reel ask as a photo-feed kickoff", () => {
    expect(looksLikeKickoffRequest("make a reel")).toBe(false);
    expect(inferKickoffFromUserMessage("make a reel")).toBeNull();
    expect(
      inferKickoffFromKipCommit(
        "make a reel",
        "I've got you down for a reel, but I need the video clip first. Send me the video and I'll draft the caption.",
      ),
    ).toBeNull();
  });

  it("treats carousel/photo asks without client media as kickoffs (generate/stock)", () => {
    expect(
      looksLikeKickoffRequest(
        "Can you make me a carrousel with cinematic business photos with text over the top?",
      ),
    ).toBe(true);
    expect(looksLikeKickoffRequest("make me a carousel")).toBe(true);
    expect(looksLikeKickoffRequest("Generate the photos")).toBe(true);
    expect(
      looksLikeKickoffRequest(
        "Make me a feed post about a safety switch check this week. Generate the photo.",
      ),
    ).toBe(true);
    expect(
      looksLikeKickoffRequest(
        "Generate a photo of the vitamin shelf and put a small caption in the corner.",
      ),
    ).toBe(true);
    expect(inferKickoffFromUserMessage("Generate a photo of the vitamin shelf")?.kind).toBe(
      "draft_posts",
    );
  });

  it("ignores plain chat", () => {
    expect(looksLikeKickoffRequest("thanks!")).toBe(false);
    expect(looksLikeKickoffRequest("what do you think of carousels?")).toBe(false);
  });

  it("looksLikeSlowSmsWork matches kickoffs only", () => {
    expect(looksLikeSlowSmsWork("draft me 3 posts")).toBe(true);
    expect(looksLikeSlowSmsWork("make me a carousel")).toBe(true);
    expect(looksLikeSlowSmsWork("what's on my calendar this week?")).toBe(false);
    expect(looksLikeSlowSmsWork("hey")).toBe(false);
  });


  it("treats imperative Post/do/want creative asks as kickoffs (no magic 'draft' verb)", () => {
    const samples = [
      "Post a good morning post with this photo",
      "post something about coffee",
      "I want a post about hiring",
      "Need a carousel on AI tools",
      "Do a post comparing Cursor and Claude",
      "a post comparing ai coding tools",
      "Can you post about our launch",
    ];
    for (const s of samples) {
      expect(looksLikeKickoffRequest(s), s).toBe(true);
      expect(inferKickoffFromUserMessage(s)?.kind, s).toBe("draft_posts");
    }
  });

  it("detects when the owner refers to an attached photo", () => {
    expect(refersToAttachedMedia("Post a good morning post with this photo")).toBe(true);
    expect(refersToAttachedMedia("Use this and do something inspirational")).toBe(true);
    expect(refersToAttachedMedia("Use this a do something inspirational")).toBe(true);
    expect(refersToAttachedMedia("use this")).toBe(true);
    expect(refersToAttachedMedia("use these")).toBe(true);
    expect(refersToAttachedMedia("Could you use the photo I sent you?")).toBe(true);
    expect(refersToAttachedMedia("make me a post about hiring")).toBe(false);
    expect(refersToAttachedMedia("Generate the photo")).toBe(false);
    expect(refersToAttachedMedia("I mean no text on the image")).toBe(false);
    expect(
      refersToAttachedMedia(
        "Make me a feed post about a safety switch check this week. Generate the photo.",
      ),
    ).toBe(false);
    expect(refersToAttachedMedia("Post a good morning post with this photo")).toBe(true);
  });

  it("treats use-this / inspirational briefs and bare format-menu replies as kickoffs", () => {
    const samples = [
      "Use this and do something inspirational",
      "Use this a do something inspirational",
      "do something inspirational",
      "something inspirational",
      "A post",
      "a post",
      "A carousel",
      "carousel",
    ];
    for (const s of samples) {
      expect(looksLikeKickoffRequest(s), s).toBe(true);
      expect(inferKickoffFromUserMessage(s)?.kind, s).toBe("draft_posts");
    }
    expect(looksLikeUseThisBrief("Use this a do something inspirational")).toBe(true);
    expect(looksLikeFormatMenuReply("A post")).toBe(true);
    expect(looksLikeFormatMenuReply("carousel")).toBe(true);
    expect(looksLikeFormatMenuReply("make me a post about hiring")).toBe(false);
  });
});

describe("format-menu outbound gating", () => {
  it("recognises the Tell me what to make menu vs a draft preview", () => {
    expect(
      looksLikeFormatMenuOutbound(
        "Got it. Tell me what to make — a post, a carousel, or send a photo with a quick brief — and I'll get on it.",
      ),
    ).toBe(true);
    expect(
      looksLikeDraftPreviewOutbound(
        'Draft ready — photo post for Tips:\n\n"Hello"\n\nProposed for Tue 7:00pm. Reply "yes" to approve, or tell me a change.',
      ),
    ).toBe(true);
    expect(
      looksLikeDraftPreviewOutbound(
        "Draft ready for Tue 7:00pm:\n\nHello from the counter.\n\nReply yes to send it, or tell me a change.",
      ),
    ).toBe(true);
    expect(
      looksLikeDraftPreviewOutbound(
        "Got it. Tell me what to make — a post, a carousel, or send a photo with a quick brief — and I'll get on it.",
      ),
    ).toBe(false);
    expect(
      looksLikeDraftPreviewOutbound(
        'Not quite sure what you\'d like there. Reply "yes" to approve, tell me what to change, or "no" to discard.',
      ),
    ).toBe(false);
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

  it("routes casual 'do up a post' briefs with topicHint and count 1", () => {
    const brief =
      "Could you do up a post comparing ai coding tools with a city scape as the background";
    expect(looksLikeKickoffRequest(brief)).toBe(true);
    const r = inferKickoffFromUserMessage(brief);
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(1);
    expect(r?.payload.topicHint).toBe(brief.slice(0, 280));
    // "AI coding tools" must not flip visuals to generated
    expect(r?.payload.visuals).toBe("photo");
    expect(String(r?.ackSms ?? "")).toMatch(/that post from your brief/i);
  });

  it("maps bare 'A post' format reply to a single feed draft", () => {
    const r = inferKickoffFromUserMessage("A post");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(1);
    expect(r?.payload.preferCarousel).toBe(false);
    expect(r?.payload.format).toBeUndefined();
    expect(r?.payload.topicHint).toBe("A post");
  });

  it("maps bare carousel format reply to a single carousel", () => {
    const r = inferKickoffFromUserMessage("A carousel");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(1);
    expect(r?.payload.preferCarousel).toBe(true);
    expect(r?.payload.format).toBe("carousel");
  });

  it("maps use-this inspirational briefs to draft_posts with the brief as topicHint", () => {
    const brief = "Use this a do something inspirational";
    const r = inferKickoffFromUserMessage(brief);
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.topicHint).toBe(brief.slice(0, 280));
    expect(Number(r?.payload.count)).toBeGreaterThanOrEqual(1);
  });

  it("singular generate-a-photo asks enqueue one post", () => {
    const briefs = [
      "Generate a photo of the frames wall and put a small caption in the corner.",
      "Generate a photo of the vitamin shelf and put a small caption in the corner.",
      "Generate a picture of the pastry case with a small caption in the corner.",
    ];
    for (const brief of briefs) {
      expect(looksLikeKickoffRequest(brief), brief).toBe(true);
      const r = inferKickoffFromUserMessage(brief);
      expect(r?.kind, brief).toBe("draft_posts");
      expect(r?.payload.count, brief).toBe(1);
    }
  });

  it("singular designed tip-slide asks enqueue one post", () => {
    const briefs = [
      "Make me a designed tip slide about warm-up sets, short text overlay on a photo. Generate the photo.",
      "Make me a designed tip slide about flossing, short text overlay on a photo. Generate the photo.",
      "Make me a designed tip slide about warm-up sets, short text overlay on a photo.",
    ];
    for (const brief of briefs) {
      expect(looksLikeKickoffRequest(brief), brief).toBe(true);
      const r = inferKickoffFromUserMessage(brief);
      expect(r?.kind, brief).toBe("draft_posts");
      expect(r?.payload.count, brief).toBe(1);
      expect(String(r?.ackSms ?? ""), brief).toMatch(/that post/i);
    }
  });

  it("singular slide asks stay count 1 even when the topic contains a number", () => {
    const brief =
      "Make me a designed tip slide about 4 warm-up compounds, short text overlay on a photo. Generate the photo.";
    const r = inferKickoffFromUserMessage(brief);
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(1);
  });

  it("quantity hedges still default to two drafts", () => {
    const some = inferKickoffFromUserMessage("draft me some posts");
    expect(some?.kind).toBe("draft_posts");
    expect(some?.payload.count).toBe(2);

    const few = inferKickoffFromUserMessage("draft me a few posts");
    expect(few?.kind).toBe("draft_posts");
    expect(few?.payload.count).toBe(2);

    const fewAsk = "a few posts";
    if (looksLikeKickoffRequest(fewAsk)) {
      const bareFew = inferKickoffFromUserMessage(fewAsk);
      expect(bareFew?.kind).toBe("draft_posts");
      expect(bareFew?.payload.count).toBe(2);
    }
  });

  it("explicit piece counts still win over the default", () => {
    expect(inferKickoffFromUserMessage("draft me 3 posts")?.payload.count).toBe(3);
    expect(inferKickoffFromUserMessage("make me 3 designed tip slides")?.payload.count).toBe(3);
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

  it("keeps the owner's brief when Kip commits after chat (no dropped topicHint)", () => {
    const brief =
      "Could you do up a post comparing ai coding tools with a city scape as the background";
    const r = inferKickoffFromKipCommit(
      brief,
      "On it, drafting a text-on-image post (cityscape bg) comparing a couple AI coding tools in your voice.",
    );
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.topicHint).toBe(brief.slice(0, 280));
    expect(r?.payload.count).toBe(1);
    expect(r?.payload.visuals).toBe("photo");
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

  it("skips failure SMS when the owner already texted", async () => {
    mockedQueryOne.mockResolvedValueOnce({ id: "m1" });
    const deliver = vi.fn(async () => {});
    const results = [
      {
        brandId: "b1",
        sms: "Couldn't finish those drafts just then — try again in a moment?",
        skipIfInboundAfter: new Date().toISOString(),
      },
    ];
    await deliverUnstreamed(results, deliver);
    expect(deliver).not.toHaveBeenCalled();
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

  it("scopes the reclaim UPDATE when brandId is set", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    await reclaimStaleKickoffs({ brandId: "lab-brand" });
    const [sql, params] = mockedQuery.mock.calls[0]!;
    expect(String(sql)).toMatch(/brand_id = \$2/);
    expect(params).toEqual(expect.arrayContaining(["lab-brand"]));
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

  it("scopes reclaim + queued select when brandId is set", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);
    await runKickoffDrain(2, { brandId: "lab-brand" });
    const reclaimSql = String(mockedQuery.mock.calls[0]![0]);
    const queuedSql = String(mockedQuery.mock.calls[1]![0]);
    expect(reclaimSql).toMatch(/brand_id = \$2/);
    expect(mockedQuery.mock.calls[0]![1]).toEqual(expect.arrayContaining(["lab-brand"]));
    expect(queuedSql).toMatch(/brand_id = \$1/);
    expect(mockedQuery.mock.calls[1]![1]).toEqual(["lab-brand", 2]);
  });
});
