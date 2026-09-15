import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("../readWebsite.js", () => ({ readWebsite: vi.fn(async () => null) }));
vi.mock("../seedVisualProfile.js", () => ({ seedVisualProfileFromWebsite: vi.fn(async () => undefined) }));
vi.mock("../voice/analyzeVoice.js", () => ({
  queueVoiceAnalysis: vi.fn(async () => undefined),
}));
vi.mock("../smsConnect.js", () => ({
  isMetaConnected: vi.fn(() => false),
  isMetaConnectPartial: vi.fn(() => false),
  connectLinkMessage: () =>
    "One tap to connect Instagram + Facebook — I'll take it from there:\nhttps://app.example/c/test",
}));

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    smsConnectUrl: () => "https://app.example/c/test",
  };
});

import { query, queryOne, type Brand } from "@pulse/shared";
import {
  kickOffOnboardingAfterPayment,
  startOnboarding,
  handleAwaitingContact,
  handleAwaitingConnect,
  looksLikeDoneReply,
  welcomeContactMessage,
} from "../onboarding.js";
import { isMetaConnected, isMetaConnectPartial } from "../smsConnect.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedIsMeta = isMetaConnected as unknown as ReturnType<typeof vi.fn>;
const mockedIsPartial = isMetaConnectPartial as unknown as ReturnType<typeof vi.fn>;

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

describe("looksLikeDoneReply", () => {
  it("matches Done and close variants", () => {
    expect(looksLikeDoneReply("Done")).toBe(true);
    expect(looksLikeDoneReply("done!")).toBe(true);
    expect(looksLikeDoneReply("all done")).toBe(true);
    expect(looksLikeDoneReply("I've done that")).toBe(true);
    expect(looksLikeDoneReply("we run a cafe")).toBe(false);
  });
});

describe("kickOffOnboardingAfterPayment", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedIsMeta.mockReset();
    mockedIsPartial.mockReset();
    mockedIsMeta.mockReturnValue(false);
    mockedIsPartial.mockReturnValue(false);
    mockedQuery.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("moves a pending brand into awaiting_contact with welcome (no one-tap yet)", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "pending" } });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await kickOffOnboardingAfterPayment(brand.id);

    expect(msg.toLowerCase()).toMatch(/hi alex/);
    expect(msg.toLowerCase()).toMatch(/thanks for jumping in/);
    expect(msg.toLowerCase()).toMatch(/contact/);
    expect(msg.toLowerCase()).toMatch(/done/);
    expect(msg).not.toContain("https://app.example/c/test");

    const stateWrites = mockedQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("onboarding_state"),
    );
    expect(stateWrites.length).toBeGreaterThan(0);
    const lastPayload = JSON.stringify(stateWrites.at(-1)?.[1] ?? []);
    expect(lastPayload).toContain("awaiting_contact");
  });

  it("does not restart when already awaiting_contact", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_contact" } });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await startOnboarding(brand.id);
    expect(msg.toLowerCase()).toMatch(/contact/);
  });

  it("does not restart when already awaiting_connect", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_connect" } });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await startOnboarding(brand.id);
    expect(msg.toLowerCase()).toMatch(/instagram|facebook|skip/);
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

describe("handleAwaitingContact", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedIsMeta.mockReset();
    mockedIsMeta.mockReturnValue(false);
    mockedQuery.mockResolvedValue([]);
  });

  it("sends one-tap connect after Done", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_contact" } });
    mockedQueryOne.mockResolvedValue(brand);

    const msg = await handleAwaitingContact(brand, "Done");
    expect(msg.toLowerCase()).toMatch(/one tap/);
    expect(msg).toContain("https://app.example/c/test");
    expect(msg.match(/One tap/gi)?.length).toBe(1);
    expect(msg.toLowerCase()).toMatch(/skip/);
    const lastPayload = JSON.stringify(mockedQuery.mock.calls.at(-1)?.[1] ?? []);
    expect(lastPayload).toContain("awaiting_connect");
  });

  it("reminds them if they haven't finished the contact step", async () => {
    const brand = fakeBrand({ onboarding_state: { status: "awaiting_contact" } });
    const msg = await handleAwaitingContact(brand, "hello?");
    expect(msg.toLowerCase()).toMatch(/done/);
    expect(msg).not.toContain("https://app.example/c/test");
  });
});

describe("handleAwaitingConnect", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedIsMeta.mockReset();
    mockedIsPartial.mockReset();
    mockedIsMeta.mockReturnValue(false);
    mockedIsPartial.mockReturnValue(false);
    mockedQuery.mockResolvedValue([]);
  });

  it("says connect was incomplete on Done when OAuth is partial", async () => {
    mockedIsPartial.mockReturnValue(true);
    const brand = fakeBrand({
      onboarding_state: {
        status: "awaiting_connect",
        answers: { connect_link_sent_at: new Date().toISOString() },
      },
      platform_user_token_encrypted: "enc",
    });

    const msg = await handleAwaitingConnect(brand, "Done");
    expect(msg.toLowerCase()).toMatch(/didn't finish|did not finish|didn't finish connecting/);
    expect(msg.toLowerCase()).toMatch(/properly/);
  });

  it("does not mint a fresh link on every random reply while link is fresh", async () => {
    const brand = fakeBrand({
      onboarding_state: {
        status: "awaiting_connect",
        answers: { connect_link_sent_at: new Date().toISOString() },
      },
    });

    const msg = await handleAwaitingConnect(brand, "hows it going");
    expect(msg.toLowerCase()).toMatch(/instagram|facebook|skip/);
    expect(msg).not.toContain("https://app.example/c/test");
  });

  it("on Done with no Meta progress, says connect hasn't completed (reuses fresh link)", async () => {
    const brand = fakeBrand({
      onboarding_state: {
        status: "awaiting_connect",
        answers: { connect_link_sent_at: new Date().toISOString() },
      },
    });

    const msg = await handleAwaitingConnect(brand, "Done");
    expect(msg.toLowerCase()).toMatch(/still don't see|haven't completed|hasn't completed|not see instagram/);
    expect(msg.toLowerCase()).toMatch(/skip/);
    // Fresh link should be reused — no new URL minted in the reply.
    expect(msg).not.toContain("https://app.example/c/test");
  });
});

describe("welcomeContactMessage", () => {
  it("greets by name and asks to save the contact", () => {
    const msg = welcomeContactMessage(fakeBrand());
    expect(msg).toMatch(/Hi Alex, it's Kip, thanks for jumping in!/);
    expect(msg.toLowerCase()).toMatch(/add me to your contacts/);
    expect(msg.toLowerCase()).toMatch(/message me done/);
  });
});
