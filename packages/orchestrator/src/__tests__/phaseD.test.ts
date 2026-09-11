import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isBlockedHost,
  safePublicUrl,
  detectResearchFocus,
} from "../research.js";
import {
  looksLikeStrategyRequest,
  parseStrategyAccept,
  looksLikeStrategyRevise,
} from "../strategyBrief.js";
import { looksLikeCampaignControl } from "../campaigns.js";
import { looksLikeContentPlanRequest } from "../nichePlan.js";

describe("SSRF guards (research)", () => {
  it("blocks private and loopback hosts", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.0.0.5")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("instagram.com")).toBe(false);
  });

  it("safePublicUrl rejects blocked URLs and accepts https public ones", () => {
    expect(safePublicUrl("http://127.0.0.1/secret")).toBeNull();
    expect(safePublicUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(safePublicUrl("file:///etc/passwd")).toBeNull();
    expect(safePublicUrl("https://www.instagram.com/p/abc")).toMatch(/^https:\/\//);
    expect(safePublicUrl("instagram.com/p/abc")).toMatch(/^https:\/\//);
  });
});

describe("detectResearchFocus", () => {
  it("detects customers / niche / competitors / ads / all", () => {
    expect(detectResearchFocus("research my customers")).toBe("customers");
    expect(detectResearchFocus("research our pain points")).toBe("customers");
    expect(detectResearchFocus("research my niche")).toBe("niche");
    expect(detectResearchFocus("study the market for cafes")).toBe("niche");
    expect(detectResearchFocus("research my competitors")).toBe("competitors");
    expect(detectResearchFocus("do ad library research")).toBe("ads");
    expect(detectResearchFocus("do some research for us")).toBe("all");
  });

  it("returns null for unrelated chatter", () => {
    expect(detectResearchFocus("make the caption shorter")).toBeNull();
    expect(detectResearchFocus("yes")).toBeNull();
  });
});

describe("strategy brief SMS verbs", () => {
  it("detects strategy propose", () => {
    expect(looksLikeStrategyRequest("propose strategy")).toBe(true);
    expect(looksLikeStrategyRequest("draft a strategy brief")).toBe(true);
    expect(looksLikeStrategyRequest("build our strategy")).toBe(true);
    expect(looksLikeStrategyRequest("hello")).toBe(false);
  });

  it("parses accept all / parts", () => {
    expect(parseStrategyAccept("accept all")).toBe("all");
    expect(parseStrategyAccept("yes")).toBe("all");
    expect(parseStrategyAccept("accept ICP and pains")).toEqual(["icp", "pains"]);
    expect(parseStrategyAccept("accept positioning")).toEqual(["positioning"]);
    expect(parseStrategyAccept("keep the offers")).toEqual(["offers"]);
    expect(parseStrategyAccept("maybe later")).toBeNull();
  });

  it("detects revise intent", () => {
    expect(looksLikeStrategyRevise("revise the positioning to be calmer")).toBe(true);
    expect(looksLikeStrategyRevise("tweak ICP — more cafe owners")).toBe(true);
    expect(looksLikeStrategyRevise("accept all")).toBe(false);
  });
});

describe("content plan + campaign SMS verbs", () => {
  it("detects content plan requests", () => {
    expect(looksLikeContentPlanRequest("propose a content plan")).toBe(true);
    expect(looksLikeContentPlanRequest("weekly plan please")).toBe(true);
    expect(looksLikeContentPlanRequest("rebuild my month plan")).toBe(true);
    expect(looksLikeContentPlanRequest("post this photo")).toBe(false);
  });

  it("detects campaign pause/resume/cancel", () => {
    expect(looksLikeCampaignControl("pause the campaign")).toBe("pause");
    expect(looksLikeCampaignControl("resume campaign")).toBe("resume");
    expect(looksLikeCampaignControl("cancel my campaign")).toBe("cancel");
    expect(looksLikeCampaignControl("launch a campaign about coffee")).toBeNull();
  });
});

describe("chooseNextFormat plan bias", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("weights toward pillar format_bias when present", async () => {
    vi.doMock("@pulse/shared", async () => {
      const actual = await vi.importActual<typeof import("@pulse/shared")>("@pulse/shared");
      return {
        ...actual,
        query: vi.fn(async (sql: string) => {
          if (sql.includes("select format from posts")) {
            return [{ format: "feed" }];
          }
          return [];
        }),
        queryOne: vi.fn(async (sql: string) => {
          if (sql.includes("format_bias from pillars")) {
            return { format_bias: "story" };
          }
          return null;
        }),
      };
    });
    const { chooseNextFormat } = await import("../formats.js");
    // With last=feed and preferred=story, story should dominate the pool.
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      picks.add(await chooseNextFormat("brand-1", "pillar-1"));
    }
    expect(picks.has("story")).toBe(true);
    expect(picks.has("feed")).toBe(false); // never immediately repeat last
  });
});
