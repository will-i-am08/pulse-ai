import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Brand, Post } from "@pulse/shared";
import { emptyBrandVoiceProfile } from "@pulse/shared";
import {
  parseDestinationChoice,
  extractPlatforms,
  fitCaption,
  buildPlatformCaptions,
  slicesForApproval,
  selectedDestinations,
  captionsForPost,
  shouldPublishImmediately,
  destinationAck,
  approvalReply,
  approveSelectedDestinations,
  persistDestinations,
  persistEditedCaptions,
  CAPTION_LIMITS,
} from "../destinations.js";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => ({ id: "sibling-1" })),
  };
});

import { query, queryOne } from "@pulse/shared";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

const PHOTO = "11111111-1111-1111-1111-111111111111";

const longSource = [
  "Morning light on the counter, first pour of the day, and the kind of quiet that makes you want to stay.",
  "Come through for a flat white and a pastry before the rush — we saved you a seat by the window.",
  "Tell a friend, bring a book, linger a little longer than you meant to.",
  "Weekend hours run late and the playlist stays easy; if you need a table for six, just say when.",
  "We roast in small batches so the cup in your hand actually tastes like the farm we talk about.",
].join(" ");

function fakePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    brand_id: "brand-1",
    caption: longSource,
    media_ids: [PHOTO],
    source_media_ids: [PHOTO],
    style_meta: {},
    pillar_id: null,
    format: "feed",
    is_auto: false,
    hold_notified_at: null,
    chased_at: null,
    campaign_id: null,
    platform: "instagram",
    destinations: [],
    captions: {},
    status: "pending_approval",
    scheduled_at: null,
    published_at: null,
    external_post_id: null,
    engagement: {},
    retry_count: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeBrand(): Brand {
  return {
    id: "brand-1",
    name: "Test Brand",
    client_phone: "+61400000000",
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" },
    contact_card_sent_at: null,
    brand_voice_profile: emptyBrandVoiceProfile(),
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
    voice_guide_md: null,
    voice_analysis_state: { status: "none" },
    facts: {},
    visual: {},
    icp: {},
    pain_points: {},
    positioning: {},
    offers: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue([]);
  mockedQueryOne.mockReset();
  mockedQueryOne.mockResolvedValue({ id: "sibling-1" });
});

describe("parseDestinationChoice", () => {
  it("reads X only", () => {
    expect(parseDestinationChoice("X only")).toEqual(["x"]);
    expect(parseDestinationChoice("twitter only")).toEqual(["x"]);
  });

  it("reads Threads only", () => {
    expect(parseDestinationChoice("Threads only")).toEqual(["threads"]);
  });

  it("reads X and Threads together", () => {
    expect(parseDestinationChoice("X and Threads")).toEqual(["x", "threads"]);
    expect(parseDestinationChoice("post this to X and Threads")).toEqual(["x", "threads"]);
  });

  it("still accepts Instagram and Facebook — X/Threads do not replace them", () => {
    expect(parseDestinationChoice("Instagram")).toEqual(["instagram"]);
    expect(parseDestinationChoice("Facebook only")).toEqual(["facebook"]);
    expect(parseDestinationChoice("Instagram and Facebook")).toEqual(["instagram", "facebook"]);
    expect(parseDestinationChoice("IG and X")).toEqual(["instagram", "x"]);
  });

  it("does not treat yes, edits, or questions as a channel pick", () => {
    expect(parseDestinationChoice("yes")).toBeNull();
    expect(parseDestinationChoice("make it shorter")).toBeNull();
    expect(parseDestinationChoice("should I post to X?")).toBeNull();
    expect(parseDestinationChoice("what's X doing on instagram")).toBeNull();
  });
});

describe("caption limits", () => {
  it("fits X in 280 and Threads in 500", () => {
    expect(CAPTION_LIMITS.x).toBe(280);
    expect(CAPTION_LIMITS.threads).toBe(500);
    expect(fitCaption(longSource, 280).length).toBeLessThanOrEqual(280);
    expect(fitCaption(longSource, 500).length).toBeLessThanOrEqual(500);
  });

  it("lets Threads keep a longer line than X when the source needs it", () => {
    const caps = buildPlatformCaptions(longSource);
    expect(caps.x!.length).toBeLessThanOrEqual(280);
    expect(caps.threads!.length).toBeGreaterThan(caps.x!.length);
    expect(caps.threads!.length).toBeLessThanOrEqual(500);
    expect(caps.instagram).toBe(longSource.trim());
    expect(caps.facebook).toBe(longSource.trim());
  });

  it("uses the short line on both when no longer line is needed", () => {
    const short = "Coffee's on.";
    const caps = buildPlatformCaptions(short);
    expect(caps.x).toBe(short);
    expect(caps.threads).toBe(short);
  });
});

describe("acceptance: X only / Threads only / both / edit / IG+FB", () => {
  it("1. X only → one mock X slice, same photo, nothing else", () => {
    const post = fakePost({
      destinations: ["x"],
      captions: buildPlatformCaptions(longSource),
    });
    const slices = slicesForApproval(post);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.platform).toBe("x");
    expect(slices[0]!.caption.length).toBeLessThanOrEqual(280);
    expect(slices[0]!.mediaIds).toEqual([PHOTO]);
    expect(slices.map((s) => s.platform)).not.toContain("threads");
    expect(slices.map((s) => s.platform)).not.toContain("instagram");
    expect(slices.map((s) => s.platform)).not.toContain("facebook");
  });

  it("2. Threads only → one mock Threads slice, not X, caption can exceed 280 but not 500", () => {
    const post = fakePost({
      destinations: ["threads"],
      captions: buildPlatformCaptions(longSource),
    });
    const slices = slicesForApproval(post);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.platform).toBe("threads");
    expect(slices[0]!.caption.length).toBeGreaterThan(280);
    expect(slices[0]!.caption.length).toBeLessThanOrEqual(500);
    expect(slices.map((s) => s.platform)).not.toContain("x");
  });

  it("3. Both → two slices, same photo, X short / Threads longer", () => {
    const post = fakePost({
      destinations: ["x", "threads"],
      captions: buildPlatformCaptions(longSource),
    });
    const slices = slicesForApproval(post);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.platform).toBe("x");
    expect(slices[1]!.platform).toBe("threads");
    expect(slices[0]!.mediaIds).toEqual(slices[1]!.mediaIds);
    expect(slices[0]!.caption.length).toBeLessThanOrEqual(280);
    expect(slices[1]!.caption.length).toBeGreaterThan(slices[0]!.caption.length);
  });

  it("4. Edit before yes updates the draft; X stays short; only picked channels send", () => {
    const edited = `${longSource} Rewritten after the owner asked for a punchier line about the morning pour.`;
    const captions = buildPlatformCaptions(edited);
    const post = fakePost({
      caption: edited,
      destinations: ["x", "threads"],
      captions,
    });
    expect(post.caption).toBe(edited);
    expect(captions.x!.length).toBeLessThanOrEqual(280);
    expect(captions.threads!.length).toBeLessThanOrEqual(500);
    const slices = slicesForApproval(post);
    expect(slices.map((s) => s.platform)).toEqual(["x", "threads"]);
    expect(slices[0]!.caption).toBe(captions.x);
    expect(slices[1]!.caption).toBe(captions.threads);
  });

  it("5. Instagram and Facebook still work; picking them is not replaced by X/Threads", () => {
    const ig = fakePost({ platform: "instagram", destinations: [] });
    expect(selectedDestinations(ig)).toEqual(["instagram"]);
    expect(slicesForApproval(ig)).toEqual([
      { platform: "instagram", caption: longSource, mediaIds: [PHOTO] },
    ]);

    const fb = fakePost({ platform: "facebook", destinations: ["facebook"] });
    expect(slicesForApproval(fb).map((s) => s.platform)).toEqual(["facebook"]);

    const igAndX = fakePost({ destinations: ["instagram", "x"], captions: buildPlatformCaptions(longSource) });
    expect(slicesForApproval(igAndX).map((s) => s.platform)).toEqual(["instagram", "x"]);
  });
});

describe("approval fan-out", () => {
  /** The claiming update returns the row when this caller wins it. */
  function winsTheClaim() {
    mockedQuery.mockResolvedValueOnce([{ id: "post-1" }]);
  }

  it("sets approved (not published) and clones only the extra picked channel", async () => {
    const post = fakePost({
      destinations: ["x", "threads"],
      captions: buildPlatformCaptions(longSource),
    });
    winsTheClaim();
    const { slices, dests } = await approveSelectedDestinations({
      post,
      brand: fakeBrand(),
      actor: "operator",
      postNow: false,
    });
    expect(dests).toEqual(["x", "threads"]);
    expect(slices).toHaveLength(2);

    const updateSql = String(mockedQuery.mock.calls[0]![0]);
    expect(updateSql).toContain("status = 'approved'");
    expect(updateSql).not.toContain("published");
    expect(updateSql).not.toContain("publishing");

    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
    const insertSql = String(mockedQueryOne.mock.calls[0]![0]);
    expect(insertSql).toContain("'approved'");
    const insertParams = mockedQueryOne.mock.calls[0]![1] as unknown[];
    expect(insertParams[7]).toBe("threads");
    expect(insertParams[2]).toEqual([PHOTO]);
  });

  it("writes an approval_log approved row when the claim wins", async () => {
    winsTheClaim();
    await approveSelectedDestinations({
      post: fakePost({ destinations: ["instagram"], captions: buildPlatformCaptions("ok") }),
      brand: fakeBrand(),
      actor: "owner",
      postNow: false,
    });
    const logCall = mockedQuery.mock.calls.find((c) => String(c[0]).includes("insert into approval_log"));
    expect(logCall).toBeTruthy();
    expect(String(logCall![0])).toMatch(/'approved'/);
    expect(logCall![1]).toEqual([
      "post-1",
      "brand-1",
      "owner",
      expect.stringMatching(/Approved via inbound/i),
    ]);
  });

  it("X-only approval never inserts a Threads sibling", async () => {
    winsTheClaim();
    await approveSelectedDestinations({
      post: fakePost({ destinations: ["x"], captions: buildPlatformCaptions(longSource) }),
      brand: fakeBrand(),
      actor: "operator",
      postNow: false,
    });
    expect(mockedQueryOne).not.toHaveBeenCalled();
  });

  it("past scheduled_at is treated as due now (no stale weekday kept on the row)", async () => {
    winsTheClaim();
    const past = "2026-09-17T13:21:00.000Z"; // Thu — live bug when approved on Fri
    const before = Date.now();
    await approveSelectedDestinations({
      post: fakePost({
        destinations: ["instagram"],
        scheduled_at: past,
        captions: buildPlatformCaptions("ok"),
      }),
      brand: fakeBrand(),
      actor: "owner",
      postNow: false,
    });
    const updateParams = mockedQuery.mock.calls[0]![1] as unknown[];
    const written = String(updateParams[4]);
    expect(written).not.toBe(past);
    expect(new Date(written).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  // Finding 3: a second "yes" (or dashboard-approve racing SMS-approve) used to
  // re-run the whole fan-out and duplicate every extra destination.
  it("claims the row with a pending_approval predicate", async () => {
    winsTheClaim();
    await approveSelectedDestinations({
      post: fakePost({ destinations: ["x", "threads"], captions: buildPlatformCaptions(longSource) }),
      brand: fakeBrand(),
      actor: "operator",
      postNow: false,
    });
    const updateSql = String(mockedQuery.mock.calls[0]![0]);
    expect(updateSql).toMatch(/status\s*=\s*'pending_approval'/);
    expect(updateSql).toMatch(/returning id/);
  });

  it("bails without approval_log or siblings when the claim is lost", async () => {
    // query() resolves to [] by default — i.e. zero rows updated.
    const res = await approveSelectedDestinations({
      post: fakePost({ destinations: ["x", "threads"], captions: buildPlatformCaptions(longSource) }),
      brand: fakeBrand(),
      actor: "operator",
      postNow: false,
    });
    expect(res.claimed).toBe(false);
    expect(mockedQueryOne).not.toHaveBeenCalled();
    // Only the claim attempt ran — no approval_log insert.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("reports claimed when it wins", async () => {
    winsTheClaim();
    const res = await approveSelectedDestinations({
      post: fakePost({ destinations: ["x"], captions: buildPlatformCaptions(longSource) }),
      brand: fakeBrand(),
      actor: "operator",
      postNow: false,
    });
    expect(res.claimed).toBe(true);
  });
});

describe("persistDestinations does not approve or publish", () => {
  it("only updates destinations/captions/platform", async () => {
    await persistDestinations(fakePost(), ["x"], longSource);
    const sql = String(mockedQuery.mock.calls[0]![0]);
    expect(sql).toContain("destinations");
    expect(sql).not.toMatch(/status/);
    expect(sql).not.toContain("approved");
    expect(sql).not.toContain("published");
  });
});

describe("edit persistence refits captions", () => {
  it("stores a new source caption and keeps X ≤280", async () => {
    const next = "A".repeat(400);
    await persistEditedCaptions(fakePost(), next);
    const params = mockedQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(next);
    const stored = JSON.parse(String(params[1])) as { x: string; threads: string };
    expect(stored.x.length).toBeLessThanOrEqual(280);
    expect(stored.threads.length).toBeLessThanOrEqual(500);
  });
});

describe("no API keys for X or Threads", () => {
  it("does not add X/Twitter/Threads API key env vars", () => {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "../../../shared/src/env.ts");
    const src = readFileSync(envPath, "utf8");
    expect(src).not.toMatch(/TWITTER_|X_API|X_BEARER|THREADS_TOKEN|THREADS_API/);
  });
});

describe("helpers", () => {
  it("mock-only dests publish immediately after yes", () => {
    expect(shouldPublishImmediately(["x"], false)).toBe(true);
    // Threads is a live destination once connected — not mock-only.
    expect(shouldPublishImmediately(["x", "threads"], false)).toBe(false);
    expect(shouldPublishImmediately(["instagram"], false)).toBe(false);
    expect(shouldPublishImmediately(["instagram", "x"], false)).toBe(false);
  });

  it("ack names the channels", () => {
    const caps = buildPlatformCaptions(longSource);
    expect(destinationAck(["x"], caps, longSource)).toMatch(/X only/);
    expect(approvalReply(["x", "threads"], ", going out now")).toMatch(/will not go live/);
  });

  it("extractPlatforms preserves order", () => {
    expect(extractPlatforms("threads and x")).toEqual(["threads", "x"]);
  });

  it("captionsForPost prefers stored variants", () => {
    const post = fakePost({ captions: { x: "short stored", threads: "longer stored" } });
    expect(captionsForPost(post).x).toBe("short stored");
  });
});
