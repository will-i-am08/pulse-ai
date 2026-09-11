import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Platform,
  PublishDestination,
  isPublishDestination,
  isMockOnlyPlatform,
  platformLabel,
  tiktokAuditPassed,
  linkedinBuildPostBody,
  tiktokBuildDirectPostBody,
  DEFAULT_TIKTOK_PRIVACY,
} from "@pulse/shared";
import {
  CAPTION_LIMITS,
  buildPlatformCaptions,
  fitLinkedInProfessional,
  parseDestinationChoice,
  extractPlatforms,
  slicesForApproval,
  approveSelectedDestinations,
} from "../destinations.js";
import { platformCapErrorSms, connectLinkMessage } from "../smsConnect.js";
import type { Brand, Post } from "@pulse/shared";
import { emptyBrandVoiceProfile } from "@pulse/shared";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => ({ id: "sibling-li" })),
    smsConnectUrl: (brandId: string, purpose: string) =>
      `https://kip.example/c/token-${brandId}-${purpose}`,
  };
});

import { query, queryOne } from "@pulse/shared";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

const PHOTO = "22222222-2222-2222-2222-222222222222";

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-h",
    name: "Phase H Co",
    client_phone: "+61400000099",
    discord_channel_id: null,
    discord_user_id: null,
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
    ...over,
  };
}

function fakePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-h",
    brand_id: "brand-h",
    caption: "Professional update for the team and a short TikTok hook.",
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

describe("Phase H platform enum", () => {
  it("includes linkedin and tiktok on Platform and PublishDestination", () => {
    expect(Platform).toContain("linkedin");
    expect(Platform).toContain("tiktok");
    expect(PublishDestination).toContain("linkedin");
    expect(PublishDestination).toContain("tiktok");
    expect(isPublishDestination("linkedin")).toBe(true);
    expect(isPublishDestination("tiktok")).toBe(true);
    expect(platformLabel("linkedin")).toBe("LinkedIn");
    expect(platformLabel("tiktok")).toBe("TikTok");
  });

  it("treats unaudited TikTok as mock-only until TIKTOK_AUDIT_PASSED", () => {
    const prev = process.env.TIKTOK_AUDIT_PASSED;
    delete process.env.TIKTOK_AUDIT_PASSED;
    expect(tiktokAuditPassed()).toBe(false);
    expect(isMockOnlyPlatform("tiktok")).toBe(true);
    expect(isMockOnlyPlatform("linkedin")).toBe(false);
    process.env.TIKTOK_AUDIT_PASSED = "true";
    expect(tiktokAuditPassed()).toBe(true);
    expect(isMockOnlyPlatform("tiktok")).toBe(false);
    if (prev === undefined) delete process.env.TIKTOK_AUDIT_PASSED;
    else process.env.TIKTOK_AUDIT_PASSED = prev;
  });
});

describe("Phase H caption variants", () => {
  it("caps LinkedIn at 3000 (professional) and TikTok at 2200", () => {
    expect(CAPTION_LIMITS.linkedin).toBe(3000);
    expect(CAPTION_LIMITS.tiktok).toBe(2200);
    const long = "word ".repeat(800);
    const caps = buildPlatformCaptions(long);
    expect(caps.linkedin!.length).toBeLessThanOrEqual(3000);
    expect(caps.tiktok!.length).toBeLessThanOrEqual(2200);
    expect(fitLinkedInProfessional("Wow!!! 😀😀😀😀😀😀😀 more")).not.toMatch(/!!!/);
  });
});

describe("Phase H destinations", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue([]);
    mockedQueryOne.mockReset();
    mockedQueryOne.mockResolvedValue({ id: "sibling-li" });
  });

  it("parses LinkedIn and TikTok picks", () => {
    expect(parseDestinationChoice("LinkedIn only")).toEqual(["linkedin"]);
    expect(parseDestinationChoice("TikTok only")).toEqual(["tiktok"]);
    expect(parseDestinationChoice("LinkedIn and TikTok")).toEqual(["linkedin", "tiktok"]);
    expect(extractPlatforms("post to linkedin and tt")).toEqual(["linkedin", "tiktok"]);
  });

  it("fans out LinkedIn + TikTok as isolated sibling posts", async () => {
    const post = fakePost({
      destinations: ["linkedin", "tiktok"],
      captions: buildPlatformCaptions("Hello company page and TikTok"),
    });
    const slices = slicesForApproval(post);
    expect(slices.map((s) => s.platform)).toEqual(["linkedin", "tiktok"]);
    const { dests } = await approveSelectedDestinations({
      post,
      brand: fakeBrand(),
      actor: "owner",
      postNow: true,
    });
    expect(dests).toEqual(["linkedin", "tiktok"]);
    // First post updated; second inserted as sibling (failure isolation).
    expect(mockedQuery).toHaveBeenCalled();
    expect(mockedQueryOne).toHaveBeenCalled();
  });
});

describe("Phase H SMS connect + cap errors", () => {
  it("builds LinkedIn and TikTok connect links", () => {
    const brand = fakeBrand();
    expect(connectLinkMessage(brand, "linkedin")).toMatch(/Company Page/i);
    expect(connectLinkMessage(brand, "linkedin")).toMatch(/\/c\//);
    expect(connectLinkMessage(brand, "tiktok")).toMatch(/privacy/i);
    expect(connectLinkMessage(brand, "tiktok")).toMatch(/\/c\//);
  });

  it("maps caption/consent errors to clear SMS", () => {
    expect(platformCapErrorSms("linkedin", "linkedin caption too long (max 3000): …")).toMatch(/3000/);
    expect(platformCapErrorSms("tiktok", "tiktok caption too long (max 2200): …")).toMatch(/2200/);
    expect(platformCapErrorSms("tiktok", "tiktok: music / commercial content consent required")).toMatch(
      /connect TikTok/i,
    );
  });
});

describe("Phase H live client shapes", () => {
  it("builds LinkedIn Posts API bodies for text / image / multi-image / video", () => {
    const text = linkedinBuildPostBody({
      orgId: "123",
      accessToken: "t",
      commentary: "Hello",
    });
    expect(text.author).toBe("urn:li:organization:123");
    expect(text.commentary).toBe("Hello");

    const image = linkedinBuildPostBody({
      orgId: "123",
      accessToken: "t",
      commentary: "Pic",
      mediaUrls: ["https://cdn.example/a.jpg"],
    });
    expect(image._kip_media_kind).toBe("image");

    const multi = linkedinBuildPostBody({
      orgId: "123",
      accessToken: "t",
      commentary: "Album",
      mediaUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.png"],
    });
    expect(multi._kip_media_kind).toBe("multi_image");

    const video = linkedinBuildPostBody({
      orgId: "123",
      accessToken: "t",
      commentary: "Clip",
      mediaUrls: ["https://cdn.example/v.mp4"],
    });
    expect(video._kip_media_kind).toBe("video");
  });

  it("builds TikTok Direct Post video body with AIGC and requires music consent", () => {
    expect(() =>
      tiktokBuildDirectPostBody({
        accessToken: "t",
        title: "hi",
        mediaUrls: ["https://cdn.example/v.mp4"],
        privacy: { ...DEFAULT_TIKTOK_PRIVACY, music_usage_confirmed: false },
      }),
    ).toThrow(/music/);

    const { url, body } = tiktokBuildDirectPostBody({
      accessToken: "t",
      title: "AI clip",
      mediaUrls: ["https://cdn.example/v.mp4"],
      privacy: { ...DEFAULT_TIKTOK_PRIVACY, music_usage_confirmed: true },
      aigc: true,
    });
    expect(url).toMatch(/video\/init/);
    expect((body.post_info as { is_aigc?: boolean }).is_aigc).toBe(true);
  });
});
