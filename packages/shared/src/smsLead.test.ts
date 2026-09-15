import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

describe("sms lead helpers", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.APP_BASE_URL = "https://kip.example";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  async function load() {
    const mod = await import("./smsLead.js");
    const { resetServerEnvCache } = await import("./env.js");
    resetServerEnvCache();
    return mod;
  }

  it("builds a cross-platform sms: href with ?&body=", async () => {
    const { smsComposeHref, smsLeadPrefillBody } = await load();
    expect(smsComposeHref("+61412345678", smsLeadPrefillBody())).toBe(
      "sms:+61412345678?&body=Hi%20Kip",
    );
    expect(smsComposeHref("+61412345678", smsLeadPrefillBody("flyer"))).toBe(
      "sms:+61412345678?&body=Hi%20Kip%20flyer",
    );
  });

  it("normalises campaign slugs and rejects reserved / junk", async () => {
    const { normalizeSmsLeadSource } = await load();
    expect(normalizeSmsLeadSource("Flyer")).toBe("flyer");
    expect(normalizeSmsLeadSource("market-stall")).toBe("market-stall");
    expect(normalizeSmsLeadSource("qr")).toBeNull();
    expect(normalizeSmsLeadSource("../x")).toBeNull();
    expect(normalizeSmsLeadSource("")).toBeNull();
  });

  it("parses Hi Kip {src} from an inbound body", async () => {
    const { parseSmsLeadSource } = await load();
    expect(parseSmsLeadSource("Hi Kip")).toBeNull();
    expect(parseSmsLeadSource("Hi Kip flyer")).toBe("flyer");
    expect(parseSmsLeadSource("  HI KIP poster  ")).toBe("poster");
    expect(parseSmsLeadSource("card")).toBe("card");
  });

  it("classifies STOP / HELP / lead", async () => {
    const { classifyUnknownInbound } = await load();
    expect(classifyUnknownInbound("STOP")).toBe("opt_out");
    expect(classifyUnknownInbound("help")).toBe("help");
    expect(classifyUnknownInbound("Hi Kip flyer")).toBe("lead");
    expect(classifyUnknownInbound("")).toBe("lead");
  });

  it("detects mobile user-agents and ignores desktop", async () => {
    const { isMobileUserAgent } = await load();
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36")).toBe(true);
    expect(
      isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"),
    ).toBe(false);
    expect(isMobileUserAgent(null)).toBe(false);
  });

  it("prefills signup with local AU phone and acquisition facts", async () => {
    const { phoneForSignupQuery, smsLeadSignupPath, smsLeadSignupUrl, mergeSignupAcquisition } = await load();
    expect(phoneForSignupQuery("+61412345678")).toBe("0412345678");
    expect(smsLeadSignupPath("+61412345678", "flyer")).toBe(
      "/signup?from=sms&phone=0412345678&src=flyer",
    );
    expect(smsLeadSignupUrl("+61412345678", "flyer")).toBe(
      "https://kip.example/signup?from=sms&phone=0412345678&src=flyer",
    );
    const facts = mergeSignupAcquisition(
      { owner_name: "Sam" },
      { from: "sms", src: "flyer", now: new Date("2026-09-15T00:00:00.000Z") },
    );
    expect(facts).toEqual({
      owner_name: "Sam",
      acquisition: { channel: "sms", source: "flyer", captured_at: "2026-09-15T00:00:00.000Z" },
    });
    expect(mergeSignupAcquisition({ owner_name: "Sam" }, { from: "web" })).toEqual({ owner_name: "Sam" });
  });

  it("keeps welcome / repeat copy free of em dashes", async () => {
    const { smsLeadWelcomeMessage, smsLeadRepeatMessage, smsLeadHelpMessage } = await load();
    const { isChatClean: clean } = await import("./sanitize.js");
    const welcome = smsLeadWelcomeMessage("+61412345678", "card");
    expect(welcome).toContain("https://kip.example/signup?from=sms&phone=0412345678&src=card");
    expect(welcome).toContain("Hey, I'm Kip");
    expect(clean(welcome)).toBe(true);
    expect(clean(smsLeadRepeatMessage("+61412345678"))).toBe(true);
    expect(clean(smsLeadHelpMessage())).toBe(true);
  });

  it("rate-limits welcome replies inside 24h", async () => {
    const { repliedWithinCooldown } = await load();
    const now = Date.parse("2026-09-15T12:00:00.000Z");
    expect(repliedWithinCooldown("2026-09-15T11:00:00.000Z", now)).toBe(true);
    expect(repliedWithinCooldown("2026-09-14T11:59:00.000Z", now)).toBe(false);
    expect(repliedWithinCooldown(null, now)).toBe(false);
  });

  it("builds stable /hi paths", async () => {
    const { publicHiPath } = await load();
    expect(publicHiPath()).toBe("/hi");
    expect(publicHiPath("flyer")).toBe("/hi/flyer");
    expect(publicHiPath("qr")).toBe("/hi");
  });
});
