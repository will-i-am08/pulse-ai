import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("../readWebsite.js", () => ({ readWebsite: vi.fn(async () => null) }));
vi.mock("../seedVisualProfile.js", () => ({ seedVisualProfileFromWebsite: vi.fn(async () => undefined) }));
vi.mock("../queueVoiceAnalysis.js", () => ({ queueVoiceAnalysis: vi.fn(async () => undefined) }));
vi.mock("../smsConnect.js", () => ({
  isMetaConnected: vi.fn(() => false),
  connectLinkMessage: () => "Connect Instagram + Facebook:\nhttps://app.example/c/test",
}));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

import { query, queryOne, type Brand } from "@pulse/shared";
import { kickOffOnboardingAfterPayment, startOnboarding } from "../onboarding.js";
import { isMetaConnected } from "../smsConnect.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedIsMeta = isMetaConnected as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Fitzroy Cafe",
    client_phone: "+61400000000",
    owner_user_id: "user-1",
    account_type: "business",
    website: null,
    onboarding_state: { status: "pending" },
    contact_card_sent_at: null,
    brand_voice_profile: {} as Brand["brand_voice_profile"],
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
    ad_account_id: null,
    ads_tokens_encrypted: null,
    ads_connected_at: null,
    facts: { owner_name: "Alex" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as Brand;
}

describe("kickOffOnboardingAfterPayment", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedIsMeta.mockReset();
    mockedIsMeta.mockReturnValue(false);
    mockedQuery.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("moves a pending brand into awaiting_connect and returns the connect SMS", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "pending" } });
    // kickOff → startOnboarding each load the brand; saveState uses query.
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await kickOffOnboardingAfterPayment(brand.id);

    expect(msg.toLowerCase()).toMatch(/instagram/);
    expect(msg).toContain("https://app.example/c/test");
    expect(msg.toLowerCase()).toMatch(/skip/);

    const stateWrites = mockedQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("onboarding_state"),
    );
    expect(stateWrites.length).toBeGreaterThan(0);
    const lastPayload = JSON.stringify(stateWrites.at(-1)?.[1] ?? []);
    expect(lastPayload).toContain("awaiting_connect");
  });

  it("does not restart when already awaiting_connect", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_connect" } });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await startOnboarding(brand.id);
    expect(msg.toLowerCase()).toMatch(/still waiting/);
    // No new awaiting_connect write that would reset answers.
    const resets = mockedQuery.mock.calls.filter((c) => {
      const sql = String(c[0] ?? "");
      const args = JSON.stringify(c[1] ?? []);
      return sql.includes("onboarding_state") && args.includes("awaiting_connect");
    });
    expect(resets).toHaveLength(0);
  });

  it("tells them they're already set up when done", async () => {
    const brand = fakeBrand({
      onboarding_state: { status: "done", completed_at: "2026-01-01T00:00:00Z" },
      facts: { owner_name: "Alex" },
    });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await kickOffOnboardingAfterPayment(brand.id);
    expect(msg.toLowerCase()).toMatch(/already set up/);
  });
});
