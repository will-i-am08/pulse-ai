import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({
  callLLM: vi.fn(async () => "Skimming through your posts now so I don't re-ask stuff you already show. What's your niche?"),
}));
vi.mock("../voice/analyzeVoice.js", () => ({
  queueVoiceAnalysis: vi.fn(async () => undefined),
}));
vi.mock("../smsConnect.js", () => ({
  isMetaConnected: vi.fn(() => true),
  isMetaConnectPartial: vi.fn(() => false),
  connectLinkMessage: () => "https://app.example/c/test",
}));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

import { query, queryOne, normalizeBrandVoiceProfile, type Brand } from "@pulse/shared";
import {
  onChannelsConnectedDuringOnboarding,
  continueOnboardingAfterVoiceAnalysis,
} from "../onboarding.js";
import { queueVoiceAnalysis } from "../voice/analyzeVoice.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedQueue = queueVoiceAnalysis as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Fitzroy Cafe",
    client_phone: "+61400000000",
    owner_user_id: "user-1",
    account_type: "business",
    website: null,
    onboarding_state: { status: "awaiting_connect" },
    contact_card_sent_at: null,
    brand_voice_profile: {} as Brand["brand_voice_profile"],
    voice_guide_md: null,
    voice_analysis_state: { status: "none" },
    ig_user_id: "ig1",
    fb_page_id: "fb1",
    fb_page_name: "Fitzroy",
    ig_username: "fitzroycafe",
    platform_tokens_encrypted: "enc",
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
    ad_account_id: null,
    ads_tokens_encrypted: null,
    ads_connected_at: null,
    facts: { owner_name: "Alex" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as Brand;
}

describe("normalizeBrandVoiceProfile", () => {
  it("fills defaults for empty {}", () => {
    const v = normalizeBrandVoiceProfile({});
    expect(v.notes).toEqual([]);
    expect(v.tone).toEqual([]);
    expect(v.emoji_policy).toBe("sparing");
  });
});

describe("onChannelsConnectedDuringOnboarding (background harvest)", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedQueue.mockReset();
    mockedQuery.mockResolvedValue([]);
    mockedQueue.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("queues harvest and returns interview opening (does not park on reading_content)", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_connect" } });
    mockedQueryOne.mockResolvedValue(brand);

    const result = await onChannelsConnectedDuringOnboarding(brand.id);

    expect(result.handled).toBe(true);
    expect(result.message).toBeTruthy();
    expect(result.message!.toLowerCase()).not.toMatch(/one sec|hang tight|reading your existing posts now/);
    expect(mockedQueue).toHaveBeenCalledWith(brand.id);

    const stateWrites = mockedQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("onboarding_state"),
    );
    const payloads = stateWrites.map((c) => JSON.stringify(c[1] ?? []));
    expect(payloads.some((p) => p.includes("in_progress"))).toBe(true);
    expect(payloads.every((p) => !p.includes('"reading_content"'))).toBe(true);
  });

  it("does not restart interview when already in_progress", async () => {
    const brand = fakeBrand({
      onboarding_state: {
        status: "in_progress",
        turns: 2,
        transcript: [{ role: "assistant", content: "What's your niche?" }],
      },
    });
    mockedQueryOne.mockResolvedValue(brand);

    const result = await onChannelsConnectedDuringOnboarding(brand.id);
    expect(result.handled).toBe(true);
    expect(result.message).toBeUndefined();
    expect(mockedQueue).toHaveBeenCalledWith(brand.id);
  });
});

describe("continueOnboardingAfterVoiceAnalysis", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedQuery.mockResolvedValue([]);
  });

  it("no-ops when interview already started (in_progress)", async () => {
    mockedQueryOne.mockResolvedValue(
      fakeBrand({ onboarding_state: { status: "in_progress" } }),
    );
    const msg = await continueOnboardingAfterVoiceAnalysis("brand-1");
    expect(msg).toBeNull();
  });

  it("starts interview for legacy reading_content brands", async () => {
    const brand = fakeBrand({
      onboarding_state: { status: "reading_content", answers: { connected_meta: "1" } },
    });
    mockedQueryOne.mockResolvedValue(brand);
    const msg = await continueOnboardingAfterVoiceAnalysis(brand.id);
    expect(msg).toBeTruthy();
  });
});
