import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => (s.startsWith("enc:") ? s.slice(4) : s),
  };
});
vi.mock("@pulse/graph", () => ({
  getGraphAdapter: vi.fn(() => ({
    reply: vi.fn(async () => ({ externalReplyId: "ext-1" })),
    hide: vi.fn(async () => undefined),
  })),
}));

import { callLLM } from "../llm.js";
import { SEND_DRAFT_RE } from "../processInbound.js";
import { query, queryOne, type Brand, type Interaction } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import {
  buildLeadCard,
  formatLeadCardSms,
  inferLeadIntent,
  suggestLeadNextStep,
} from "../leadCard.js";
import {
  pushLeadToCrm,
  isValidCrmWebhookUrl,
  getCrmWebhookUrl,
  setCrmWebhookUrl,
} from "../crmWebhook.js";
import {
  handleInteraction,
  sendDraftInstead,
  claimLatestLead,
  markLatestAsSpam,
} from "../engagement.js";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedGetGraph = getGraphAdapter as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function fakeBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "b1",
    name: "Test Co",
    client_phone: "+61400000000",
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" },
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
    meta_connected_at: null,
    facts: {},
    visual: {},
    icp: {},
    pain_points: {},
    positioning: {},
    offers: {},
    features: { auto_replies: true, lead_handoff: true, crm_webhook: false },
    crm_webhook_url: null,
    approver: "operator",
    status: "active",
    created_at: "2026-09-11T10:00:00.000Z",
    updated_at: "2026-09-11T10:00:00.000Z",
    ...over,
  } as Brand;
}

function fakeInteraction(over: Partial<Interaction> = {}): Interaction {
  return {
    id: "i1",
    brand_id: "b1",
    platform: "instagram",
    kind: "dm",
    external_id: "ext",
    author: "@alex",
    text: "Can I book for Saturday?",
    sentiment: null,
    bucket: null,
    status: "new",
    permalink: "https://ig.me/m/alex",
    created_at: "2026-09-11T10:05:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_TO;
  delete process.env.RESEND_API_KEY;
  mockedCallLLM.mockReset();
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue([]);
  mockedQueryOne.mockReset();
  mockedQueryOne.mockResolvedValue(null);
  mockedGetGraph.mockClear();
  mockedGetGraph.mockReturnValue({
    reply: vi.fn(async () => ({ externalReplyId: "ext-1" })),
    hide: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("I2 lead card", () => {
  it("builds a stable JSON shape with required fields", () => {
    const card = buildLeadCard({
      interaction: fakeInteraction(),
      brandId: "b1",
      brandName: "Test Co",
      summary: "wants Saturday booking",
    });
    expect(card).toMatchObject({
      handle: "@alex",
      platform: "instagram",
      channel: "dm",
      intent: "book",
      summary: "wants Saturday booking",
      permalink: "https://ig.me/m/alex",
      timestamp: "2026-09-11T10:05:00.000Z",
      interaction_id: "i1",
      brand_id: "b1",
    });
    expect(card.next_step).toMatch(/book/i);
  });

  it("infers intents and formats SMS for the owner", () => {
    expect(inferLeadIntent("how much for a quote?")).toBe("quote");
    expect(suggestLeadNextStep("call", "comment")).toMatch(/Call/i);
    const sms = formatLeadCardSms(
      buildLeadCard({
        interaction: fakeInteraction({ text: "Please call me" }),
        brandId: "b1",
        summary: "wants a call",
      }),
    );
    expect(sms).toContain("Lead card");
    expect(sms).toContain("@alex");
    expect(sms).toContain("Intent: call");
    expect(sms).toContain("https://ig.me/m/alex");
  });
});

describe("I3 CRM webhook POST", () => {
  it("validates https URLs only", () => {
    expect(isValidCrmWebhookUrl("https://hooks.zapier.com/x")).toBe(true);
    expect(isValidCrmWebhookUrl("http://insecure.example/x")).toBe(false);
    expect(isValidCrmWebhookUrl("not-a-url")).toBe(false);
  });

  it("POSTs lead card JSON and audits success", async () => {
    const brand = fakeBrand({
      features: { crm_webhook: true },
      crm_webhook_url: "https://hooks.example/catch",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const result = await pushLeadToCrm({
      brand,
      interaction: fakeInteraction({ status: "escalated", bucket: "lead" }),
      trigger: "owner_sms",
      force: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      emailFallback: false,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("success");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hooks.example/catch",
      expect.objectContaining({ method: "POST" }),
    );
    const callArgs = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(callArgs[1].body));
    expect(body.handle).toBe("@alex");
    expect(body.channel).toBe("dm");
    expect(body.platform).toBe("instagram");
    expect(
      mockedQuery.mock.calls.some(
        (c) => String(c[0]).includes("crm_push_log") && Array.isArray(c[1]) && c[1][3] === "success",
      ),
    ).toBe(true);
  });

  it("skips when crm_webhook feature is off (unless force)", async () => {
    const brand = fakeBrand({
      features: { crm_webhook: false },
      crm_webhook_url: "https://hooks.example/catch",
    });
    const fetchImpl = vi.fn();
    const skipped = await pushLeadToCrm({
      brand,
      interaction: fakeInteraction(),
      trigger: "auto_lead",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(skipped.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();

    const forced = await pushLeadToCrm({
      brand,
      interaction: fakeInteraction(),
      trigger: "owner_sms",
      force: true,
      fetchImpl: vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch,
      emailFallback: false,
    });
    expect(forced.ok).toBe(true);
  });

  it("records failure and can email-fallback when EMAIL_FROM is set", async () => {
    process.env.EMAIL_FROM = "kip@example.com";
    process.env.EMAIL_TO = "owner@example.com";
    process.env.RESEND_API_KEY = "re_test";
    const brand = fakeBrand({
      features: { crm_webhook: true },
      crm_webhook_url: "https://hooks.example/catch",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const result = await pushLeadToCrm({
      brand,
      interaction: fakeInteraction(),
      trigger: "auto_lead",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      emailFallback: true,
    });
    expect(result.ok).toBe(true);
    expect(result.emailed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("resend.com");
  });

  it("setCrmWebhookUrl encrypts and enables the feature", async () => {
    mockedQueryOne.mockResolvedValueOnce({ features: {} }); // setBrandFeatures read
    await setCrmWebhookUrl("b1", "https://hooks.zapier.com/abc");
    expect(mockedQuery.mock.calls[0]![1]![0]).toBe("enc:https://hooks.zapier.com/abc");
    expect(getCrmWebhookUrl(fakeBrand({ crm_webhook_url: "https://plain.example/x" }))).toBe(
      "https://plain.example/x",
    );
  });
});

describe("I1 SMS engagement verbs", () => {
  it("sendDraftInstead replaces body and posts", async () => {
    mockedQueryOne
      .mockResolvedValueOnce({ id: "i-draft", brand_id: "b1", status: "drafted", platform: "instagram", kind: "comment" })
      .mockResolvedValueOnce({ id: "r1", body: "old" });
    const sent = await sendDraftInstead(fakeBrand(), "Come by Saturday!");
    expect(sent).toBe("Come by Saturday!");
    expect(mockedQuery.mock.calls.some((c) => String(c[0]).includes("set body"))).toBe(true);
  });

  it("claimLatestLead resolves the escalated lead", async () => {
    mockedQueryOne.mockResolvedValueOnce(
      fakeInteraction({ status: "escalated", bucket: "lead" }),
    );
    const claimed = await claimLatestLead(fakeBrand());
    expect(claimed?.id).toBe("i1");
    expect(
      mockedQuery.mock.calls.some(
        (c) => String(c[0]).includes("update interactions set status") && c[1]![0] === "resolved",
      ),
    ).toBe(true);
  });

  it("markLatestAsSpam hides and calls graph.hide", async () => {
    mockedQueryOne.mockResolvedValueOnce(fakeInteraction({ status: "drafted" }));
    const hidden = await markLatestAsSpam(fakeBrand());
    expect(hidden?.id).toBe("i1");
    const graph = mockedGetGraph.mock.results.at(-1)?.value as { hide: ReturnType<typeof vi.fn> };
    expect(graph.hide).toHaveBeenCalled();
  });
});

describe("I4 feature toggles", () => {
  it("auto_replies off forces draft instead of auto", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({ bucket: "general", sentiment: "positive", action: "auto", reply: "thanks!" }),
    );
    const res = await handleInteraction(
      fakeBrand({ features: { auto_replies: false, lead_handoff: true } }),
      fakeInteraction({ kind: "comment", text: "love this" }),
    );
    expect(res.publicReply).toBeUndefined();
    expect(res.ownerMessage).toContain("Suggested reply");
    expect(res.ownerMessage).toContain("approve that reply");
  });

  it("lead_handoff off suppresses owner SMS but still can flag CRM push", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        bucket: "lead",
        sentiment: "positive",
        action: "escalate",
        reply: "here's the link",
        summary: "wants to book",
      }),
    );
    const res = await handleInteraction(
      fakeBrand({ features: { lead_handoff: false, crm_webhook: true, auto_replies: true } }),
      fakeInteraction(),
    );
    expect(res.ownerMessage).toBeUndefined();
    expect(res.publicReply).toBe("here's the link");
    expect(res.leadCardPush).toBe(true);
  });

  it("qualified lead owner message uses lead card + Phase I verbs", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({
        bucket: "lead",
        sentiment: "positive",
        action: "escalate",
        reply: "book here",
        summary: "Saturday booking",
      }),
    );
    const res = await handleInteraction(fakeBrand(), fakeInteraction());
    expect(res.ownerMessage).toContain("Lead card");
    expect(res.ownerMessage).toContain("I'll take it");
    expect(res.ownerMessage).toContain("send to CRM");
  });
});

/** Regex contracts used by processInbound (kept here so verb polish can't silently regress). */
describe("I1 SMS verb regex contracts", () => {
  // Imported, not copied: a local copy silently drifted from the real matcher.
  const SEND_INSTEAD_RE = /^\s*send this instead\s*[:\-–]?\s*(.+)$/is;
  const TAKE_LEAD_RE =
    /^\s*(i'?ll take it|i will take it|i'?ll take this|claim (it|the lead)|i'?ve got (it|this))\s*[.!]?\s*$/i;
  const MARK_SPAM_RE = /^\s*(mark (it |that |this )?(as )?spam|it'?s spam)\s*[.!]?\s*$/i;
  const SET_CRM_WEBHOOK_RE = /^\s*(set|save|update)\s+(crm\s+)?webhook\s+(?:to\s+|url\s+)?(\S+)/i;
  const SEND_TO_CRM_RE = /^\s*(send|push|post)\s+(it |this |that )?(to\s+)?(crm|zapier|make|hubspot|pipedrive)\b/i;

  it("matches approve / send / instead / take / spam / CRM verbs", () => {
    expect(SEND_DRAFT_RE.test("approve that reply")).toBe(true);
    expect(SEND_DRAFT_RE.test("send it")).toBe(true);
    expect(SEND_INSTEAD_RE.exec("send this instead: Thanks, we're free Sat!")?.[1]?.trim()).toBe(
      "Thanks, we're free Sat!",
    );
    expect(TAKE_LEAD_RE.test("I'll take it")).toBe(true);
    expect(MARK_SPAM_RE.test("mark as spam")).toBe(true);
    expect(SET_CRM_WEBHOOK_RE.exec("set crm webhook https://hooks.zapier.com/x")?.[3]).toBe(
      "https://hooks.zapier.com/x",
    );
    expect(SEND_TO_CRM_RE.test("send to CRM")).toBe(true);
  });
});
