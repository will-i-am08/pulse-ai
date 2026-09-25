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

vi.mock("../kickoffs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kickoffs.js")>();
  return {
    ...actual,
    enqueueKickoff: vi.fn(async () => ({
      kickoff: { id: "kick-1" },
      alreadyQueued: false,
      ackSms: "On it — drafting.",
    })),
  };
});

vi.mock("../draftCaption.js", () => ({
  draftCaption: vi.fn(async () => ({ caption: "Hello latte", proposedTime: null })),
}));

vi.mock("../library.js", () => ({
  pickFreshPhoto: vi.fn(async () => null),
  draftPostFromPhoto: vi.fn(async () => null),
}));

vi.mock("../ugc/index.js", () => ({
  queueUgcJob: vi.fn(async () => ({ ok: false, sms: "UGC isn't set up." })),
}));

vi.mock("../aiVideo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiVideo.js")>();
  return {
    ...actual,
    queueAiVideoJob: vi.fn(async () => ({ ok: false, sms: "AI video isn't set up." })),
  };
});

vi.mock("../performanceDigest.js", () => ({
  buildPerformanceAnalysis: vi.fn(async () => ({
    text: "Quiet week.",
    insight: "Not enough data yet.",
    recommendation: "Keep posting.",
    winners: [],
    suggestion: null,
    enoughData: false,
  })),
}));

vi.mock("../scheduler.js", () => ({
  scheduleSlot: vi.fn(async () => new Date("2026-09-20T11:00:00.000Z")),
}));

vi.mock("../formats.js", () => ({
  draftStoryFromPhoto: vi.fn(async () => null),
  draftCarouselFromPhotos: vi.fn(async () => ({
    post: { id: "car-1", caption: "Three slides", media_ids: ["m1", "m2"] },
    mediaUrl: "https://example.com/car.jpg",
  })),
}));

vi.mock("../pillars.js", () => ({
  ensurePillars: vi.fn(async () => [{ id: "pillar-1", posts_per_week: 2, name: "Product" }]),
}));

vi.mock("../nichePlan.js", () => ({
  getProposedPlan: vi.fn(async () => null),
  applyNichePlan: vi.fn(async () => {}),
}));

import { enqueueKickoff } from "../kickoffs.js";
import { draftPostFromPhoto } from "../library.js";
import { draftCarouselFromPhotos } from "../formats.js";
import { applyNichePlan, getProposedPlan } from "../nichePlan.js";
import {
  KIP_AGENT_TOOLS,
  buildBrandProfilePayload,
  captionExcerpt,
  executeAgentTool,
  isValidKickoffKind,
  mergeKipMemoryFact,
  looksLikeCalendarAsk,
  looksLikeIdeasAsk,
  looksLikeBrandRecallAsk,
  summarizeBrandRecall,
  summarizeCalendar,
} from "../agentTools.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedEnqueue = enqueueKickoff as unknown as ReturnType<typeof vi.fn>;

function stubBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Sunrise Cafe",
    facts: {
      owner_name: "Sam",
      hours: "7am–3pm",
      kip_preferences: [{ text: "prefer carousels", atISO: "2026-01-01T00:00:00.000Z" }],
    },
    brand_voice_profile: { tone: ["warm", "direct"] },
    ig_username: "sunrise",
    ...over,
  } as Brand;
}

describe("KIP_AGENT_TOOLS", () => {
  it("defines the expected tool names", () => {
    expect(KIP_AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      "check_calendar",
      "confirm_pending_ask",
      "draft_copy",
      "escalate_to_human",
      "get_offered_draft",
      "pull_analytics",
      "regenerate_creative",
      "reject_draft",
      "remember_fact",
      "restyle_image",
      "revise_caption",
      "schedule_post",
      "scout_ideas",
      "set_image_text",
    ]);
    for (const t of KIP_AGENT_TOOLS) {
      expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
    }
    const draft = KIP_AGENT_TOOLS.find((t) => t.name === "draft_copy");
    expect(draft?.input_schema).toMatchObject({ required: ["job"] });
    expect(draft?.description).toMatch(/Never scout_ideas for a draft ask/i);
    expect(draft?.description).toMatch(/overlay none or headline/i);
    expect(draft?.description).toMatch(/repeat it|THIS brand's overlay language/i);
    expect((draft?.input_schema as { properties?: Record<string, { enum?: string[] }> }).properties?.overlay?.enum).toEqual(
      ["none", "headline"],
    );
    expect(draft?.description).toMatch(/elements none or mark or constructed/i);
    expect(draft?.description).toMatch(/THIS brand's construction language/i);
    expect((draft?.input_schema as { properties?: Record<string, { enum?: string[] }> }).properties?.elements?.enum).toEqual(
      ["none", "mark", "constructed"],
    );
    const scout = KIP_AGENT_TOOLS.find((t) => t.name === "scout_ideas");
    expect(scout?.description).toMatch(/call draft_copy instead/i);
    const escalate = KIP_AGENT_TOOLS.find((t) => t.name === "escalate_to_human");
    expect(escalate?.input_schema).toMatchObject({ required: ["reason", "summary"] });
  });
});

describe("helpers", () => {
  it("isValidKickoffKind accepts only KipKickoffKind values", () => {
    expect(isValidKickoffKind("draft_posts")).toBe(true);
    expect(isValidKickoffKind("publish_now")).toBe(false);
    expect(isValidKickoffKind(null)).toBe(false);
  });

  it("captionExcerpt truncates long captions", () => {
    expect(captionExcerpt("hi")).toBe("hi");
    expect(captionExcerpt("x".repeat(200)).endsWith("…")).toBe(true);
  });

  it("mergeKipMemoryFact appends under kip_preferences / kip_decisions", () => {
    const merged = mergeKipMemoryFact({}, "kip_preferences", "no emojis", "2026-09-14T12:00:00.000Z");
    expect(merged.kip_preferences).toEqual([
      { text: "no emojis", atISO: "2026-09-14T12:00:00.000Z" },
    ]);
    const again = mergeKipMemoryFact(merged, "kip_decisions", "skip stories this week");
    expect(again.kip_decisions?.[0]?.text).toBe("skip stories this week");
    expect(again.kip_preferences).toHaveLength(1);
  });

  it("summarizeCalendar speaks weekday prose, not JSON", () => {
    const now = new Date("2026-09-14T10:00:00.000Z");
    const out = summarizeCalendar(
      [
        {
          id: "p1",
          status: "scheduled",
          scheduled_at: "2026-09-14T11:00:00.000Z",
          caption: "Latte art",
        },
      ],
      7,
      now,
    );
    expect(() => JSON.parse(out)).toThrow();
    expect(out.toLowerCase()).toMatch(/latte art/);
    expect(out).toMatch(/scheduled/i);
    expect(out).not.toMatch(/emptyDays/);
    expect(out).not.toMatch(/2026-09-15T/);
  });

  it("summarizeCalendar caps at four posts and notes the rest", () => {
    const now = new Date("2026-09-14T10:00:00.000Z");
    const posts = [0, 1, 2, 3, 4].map((i) => ({
      id: `p${i}`,
      status: "scheduled" as const,
      scheduled_at: new Date(now.getTime() + (i + 1) * 60 * 60 * 1000).toISOString(),
      caption: `Post number ${i} with extra words so the excerpt trims`,
    }));
    const out = summarizeCalendar(posts, 7, now);
    expect(out).toMatch(/Plus 1 more/);
    expect(out).not.toMatch(/Post number 4/);
  });

  it("looksLikeCalendarAsk matches lookups and ignores drafts/ads", () => {
    expect(looksLikeCalendarAsk("what's on my calendar this week?")).toBe(true);
    expect(looksLikeCalendarAsk("check my calendar")).toBe(true);
    expect(looksLikeCalendarAsk("this week's posts")).toBe(true);
    expect(looksLikeCalendarAsk("make me a carousel this week")).toBe(false);
    expect(looksLikeCalendarAsk("can you promote our new winter menu this week")).toBe(false);
    expect(looksLikeCalendarAsk("what's on my calendar and make a carousel")).toBe(false);
  });

  it("looksLikeIdeasAsk matches suggestion asks and ignores drafts", () => {
    expect(looksLikeIdeasAsk("Give me 3 post ideas for this week")).toBe(true);
    expect(looksLikeIdeasAsk("come up with some suggestions")).toBe(true);
    expect(looksLikeIdeasAsk("what should I post")).toBe(true);
    expect(looksLikeIdeasAsk("Draft a LinkedIn post about hiring")).toBe(false);
    expect(looksLikeIdeasAsk("Draft something in my lane")).toBe(false);
    expect(looksLikeIdeasAsk("make me a carousel")).toBe(false);
    expect(looksLikeIdeasAsk("what's on my calendar")).toBe(false);
  });

  it("looksLikeBrandRecallAsk matches memory asks", () => {
    expect(looksLikeBrandRecallAsk("What do you know about my brand?")).toBe(true);
    expect(looksLikeBrandRecallAsk("what's on file about me")).toBe(true);
    expect(looksLikeBrandRecallAsk("Give me 3 post ideas")).toBe(false);
    expect(looksLikeBrandRecallAsk("draft a post")).toBe(false);
  });

  it("summarizeBrandRecall lists prefs/voice without an intake quiz", () => {
    const sms = summarizeBrandRecall(
      stubBrand({
        name: "Lab Cafe",
        facts: {
          lab: true,
          kip_preferences: [{ text: "Generated photos", atISO: "2026-01-01T00:00:00.000Z" }],
        },
        brand_voice_profile: { tone: ["professional", "upbeat"] },
      }),
    );
    expect(sms).toMatch(/Generated photos/i);
    expect(sms).toMatch(/professional/i);
    expect(sms).toMatch(/Niche: not locked yet/i);
    expect(sms).not.toMatch(/are you a caf/i);
    expect(sms).not.toMatch(/Want to fill me in/i);
    expect(sms).not.toMatch(/one-liner about what you do/i);
  });
});

describe("executeAgentTool", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedEnqueue.mockReset();
    mockedQuery.mockResolvedValue([]);
    mockedQueryOne.mockResolvedValue(null);
    mockedEnqueue.mockResolvedValue({
      kickoff: { id: "kick-1" },
      alreadyQueued: false,
      ackSms: "On it — drafting.",
    });
  });

  it("buildBrandProfilePayload matches get_brand_profile shape", () => {
    const p = buildBrandProfilePayload(stubBrand());
    expect(p.name).toBe("Sunrise Cafe");
    expect(String(p.facts)).toMatch(/Sam/);
    expect(String(p.facts)).toMatch(/7am/);
    expect(String(p.connection)).toMatch(/Instagram/);
    expect(String(p.voiceToneNotes)).toMatch(/warm/);
    expect(p.kip_preferences).toEqual([
      { text: "prefer carousels", atISO: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("unknown tool name fails closed", async () => {
    const raw = await executeAgentTool("publish_now", {}, { brand: stubBrand() });
    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown tool/i);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it("draft_copy unknown job fails with allowedJobs", async () => {
    const raw = await executeAgentTool("draft_copy", { job: "publish" }, { brand: stubBrand() });
    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.allowedJobs).toEqual([
      "caption",
      "post",
      "first_batch",
      "carousel",
      "story",
      "trend",
      "competitor",
      "from_library",
      "ugc",
      "reel",
    ]);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it("draft_copy job post calls enqueueKickoff", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "post", count: 1, topic_hint: "weekend special" },
      { brand: stubBrand(), sourceMessageId: "msg-1" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.kickoffId).toBe("kick-1");
    expect(result.note).toMatch(/never auto-publishes/i);
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(mockedEnqueue.mock.calls[0]![1]).toBe("draft_posts");
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        reason: "user_request",
        sourceMessageId: "msg-1",
        payload: expect.objectContaining({
          count: 1,
          topicHint: "weekend special",
        }),
      }),
    );
  });

  it("draft_copy passes overlay choice onto the kickoff payload", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      {
        job: "post",
        count: 1,
        topic_hint: "Saturday bun",
        overlay: "none",
        overlay_tone: "quiet",
      },
      { brand: stubBrand(), sourceMessageId: "msg-ov" },
    );
    expect(JSON.parse(raw).ok).toBe(true);
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          overlay: "none",
          overlay_tone: "quiet",
          topicHint: "Saturday bun",
        }),
      }),
    );
  });

  it("draft_copy passes elements choice onto the kickoff payload", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      {
        job: "post",
        count: 1,
        topic_hint: "Saturday bun",
        elements: "constructed",
      },
      { brand: stubBrand(), sourceMessageId: "msg-el" },
    );
    expect(JSON.parse(raw).ok).toBe(true);
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          elements: "constructed",
          topicHint: "Saturday bun",
        }),
      }),
    );
  });

  it("draft_copy preserves LinkedIn from owner SMS when the model shortens the brief", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "post", count: 1, topic_hint: "hiring barista", visuals: "photo" },
      {
        brand: stubBrand(),
        sourceMessageId: "msg-li",
        ownerMessage: "Draft a LinkedIn post about hiring a barista — professional tone",
      },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          topicHint: "LinkedIn: hiring barista",
          destinations: expect.arrayContaining(["linkedin"]),
        }),
      }),
    );
  });

  it("draft_copy carousel keeps LinkedIn destinations for photo carousels", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "carousel", count: 1, topic_hint: "3 tip slides on latte art", visuals: "photo" },
      {
        brand: stubBrand(),
        ownerMessage: "Make a LinkedIn carousel about latte art tips",
      },
    );
    expect(JSON.parse(raw).ok).toBe(true);
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          preferCarousel: true,
          format: "carousel",
          destinations: expect.arrayContaining(["linkedin"]),
          topicHint: expect.stringMatching(/^LinkedIn:/i),
        }),
      }),
    );
  });

  it("draft_copy job first_batch calls enqueueKickoff", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "first_batch", visuals: "generated" },
      { brand: stubBrand(), sourceMessageId: "msg-2" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.alreadyQueued).toBe(false);
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(mockedEnqueue.mock.calls[0]![1]).toBe("first_batch");
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        reason: "user_request",
        sourceMessageId: "msg-2",
        payload: expect.objectContaining({
          count: 3,
          visuals: "generated",
        }),
      }),
    );
  });

  it("draft_copy infers count from the owner wording when count is omitted", async () => {
    await executeAgentTool(
      "draft_copy",
      { job: "post", topic_hint: "new bun" },
      { brand: stubBrand(), ownerMessage: "Draft me a post about the new bun" },
    );
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ count: 1 }) }),
    );

    mockedEnqueue.mockClear();
    await executeAgentTool(
      "draft_copy",
      { job: "post", topic_hint: "coffee" },
      { brand: stubBrand(), ownerMessage: "draft me 3 posts" },
    );
    expect(mockedEnqueue.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ count: 3 }) }),
    );
  });

  it("draft_copy post with attached photos drafts immediately instead of queueing", async () => {
    vi.mocked(draftPostFromPhoto).mockResolvedValueOnce({
      post: { id: "p-photo", caption: "Morning latte" },
      mediaUrl: "https://example.com/p.jpg",
    } as never);
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "post" },
      { brand: stubBrand(), mediaIds: ["media-1"], ownerMessage: "" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.postId).toBe("p-photo");
    expect(result.note).toMatch(/never published/i);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it("draft_copy carousel with two attached photos drafts a carousel", async () => {
    const raw = await executeAgentTool(
      "draft_copy",
      { job: "carousel" },
      { brand: stubBrand(), mediaIds: ["m1", "m2"], ownerMessage: "tasting menu, one post" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.postId).toBe("car-1");
    expect(result.slides).toBe(2);
    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(vi.mocked(draftCarouselFromPhotos)).toHaveBeenCalled();
  });

  it("confirm_pending_ask applies a plan without enqueueing first_batch", async () => {
    vi.mocked(getProposedPlan).mockResolvedValueOnce({ id: "plan-1" } as never);
    const raw = await executeAgentTool(
      "confirm_pending_ask",
      { action: "accept", kind: "plan" },
      { brand: stubBrand(), ownerMessage: "sounds good" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("plan");
    expect(result.firstBatchEnqueued).toBe(false);
    expect(vi.mocked(applyNichePlan)).toHaveBeenCalled();
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it("scout_ideas refuses a draft-shaped owner ask", async () => {
    const raw = await executeAgentTool(
      "scout_ideas",
      { focus: "autumn" },
      { brand: stubBrand(), ownerMessage: "Draft something in my lane" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/draft_copy/i);
  });

  it("schedule_post never writes status published", async () => {
    mockedQueryOne.mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      status: "pending_approval",
      caption: "Latte",
      scheduled_at: null,
      format: "feed",
      platform: "instagram",
      pillar_id: null,
    });
    const raw = await executeAgentTool(
      "schedule_post",
      { post_id: "11111111-1111-1111-1111-111111111111" },
      { brand: stubBrand() },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending_approval");
    expect(result.note).toMatch(/not published/i);
    expect(result.note).toMatch(/approval/i);
    const updates = mockedQuery.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => /update posts/i.test(sql));
    expect(updates.length).toBeGreaterThan(0);
    for (const sql of updates) {
      const setClause = sql.split(/where/i)[0] ?? sql;
      expect(setClause).not.toMatch(/\bstatus\b/i);
      expect(sql).not.toMatch(/status\s*=\s*'published'/i);
    }
  });

  it("invalid post_id returns ok false", async () => {
    mockedQueryOne.mockResolvedValue(null);
    const raw = await executeAgentTool(
      "schedule_post",
      { post_id: "not-a-real-post" },
      { brand: stubBrand() },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    const updates = mockedQuery.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => /update posts/i.test(sql));
    expect(updates).toHaveLength(0);
  });

  it("escalate_to_human records operatorAlerts / calls notifyOperator", async () => {
    const alerts: string[] = [];
    const notifyOperator = vi.fn(async (_body: string): Promise<boolean> => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const raw = await executeAgentTool(
      "escalate_to_human",
      { reason: "blocked", summary: "Need a decision on the promo" },
      { brand: stubBrand(), notifyOperator, operatorAlerts: alerts },
    );
    log.mockRestore();
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("blocked");
    expect(result.ownerAckHint).toMatch(/look into this/i);
    expect(result.note).toMatch(/stay in character/i);
    expect(notifyOperator).toHaveBeenCalledTimes(1);
    expect(String(notifyOperator.mock.calls[0]![0])).toMatch(/Sunrise Cafe/);
    expect(String(notifyOperator.mock.calls[0]![0])).toMatch(/blocked/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/Sunrise Cafe/);
  });

  it("remember_fact merges into brand.facts via query update", async () => {
    mockedQuery.mockResolvedValue([]);
    const brand = stubBrand({ facts: { owner_name: "Sam" } });
    const raw = await executeAgentTool(
      "remember_fact",
      { text: "likes punchy CTAs", bucket: "kip_preferences" },
      { brand },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(brand.facts?.kip_preferences?.some((e) => e.text === "likes punchy CTAs")).toBe(true);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = String(mockedQuery.mock.calls[0]![0]);
    expect(sql).toMatch(/update brands set facts/i);
    const stored = JSON.parse(String(mockedQuery.mock.calls[0]![1]![0]));
    expect(stored.kip_preferences.at(-1).text).toBe("likes punchy CTAs");
  });
});
