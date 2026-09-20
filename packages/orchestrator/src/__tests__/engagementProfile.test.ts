import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM (control the "decision") and the DB (no connection needed).
vi.mock("../llm.js", () => ({ callLLM: vi.fn(), stripMarkdown: (s: string) => s }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []), queryOne: vi.fn(async () => null) };
});

import { callLLM } from "../llm.js";
import { query } from "@pulse/shared";
import type { Brand, BusinessFacts } from "@pulse/shared";
import {
  readEngagementProfile,
  engagementToneLines,
  shouldRunProactive,
  proactiveBudgetFor,
  looksLikeEngagementPref,
  updateEngagementFromMessage,
} from "../engagementProfile.js";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

function brand(facts: BusinessFacts | null): Brand {
  return { id: "b1", name: "Test Co", facts } as unknown as Brand;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readEngagementProfile", () => {
  it("defaults to today's behaviour when absent", () => {
    const p = readEngagementProfile(brand({}));
    expect(p).toMatchObject({
      proactivity: "balanced",
      warmth: "friendly",
      report: { cadence: "weekly", hour_local: 8 },
      source: "default",
    });
  });

  it("reads a partial stored profile, defaulting the rest", () => {
    const p = readEngagementProfile(brand({ engagement_profile: { proactivity: "quiet" } } as BusinessFacts));
    expect(p.proactivity).toBe("quiet");
    expect(p.warmth).toBe("friendly");
    expect(p.report.cadence).toBe("weekly");
  });

  it("falls back to defaults on a malformed profile", () => {
    const p = readEngagementProfile(brand({ engagement_profile: { proactivity: "loud" } } as unknown as BusinessFacts));
    expect(p.proactivity).toBe("balanced");
  });
});

describe("engagementToneLines", () => {
  it("adds a steer for crisp and matey, nothing for friendly", () => {
    expect(engagementToneLines(readEngagementProfile(brand({ engagement_profile: { warmth: "crisp" } } as BusinessFacts)))).toHaveLength(1);
    expect(engagementToneLines(readEngagementProfile(brand({ engagement_profile: { warmth: "matey" } } as BusinessFacts)))[0]).toMatch(/banter/i);
    expect(engagementToneLines(readEngagementProfile(brand({})))).toEqual([]);
  });
});

describe("shouldRunProactive", () => {
  const quiet = readEngagementProfile(brand({ engagement_profile: { proactivity: "quiet" } } as BusinessFacts));
  const balanced = readEngagementProfile(brand({}));
  const reportOff = readEngagementProfile(brand({ engagement_profile: { report: { cadence: "off" } } } as BusinessFacts));

  it("balanced runs every channel — i.e. today's behaviour", () => {
    for (const ch of ["event_followup", "checkin", "report", "competitor", "autonomy"] as const) {
      expect(shouldRunProactive(ch, balanced)).toBe(true);
    }
  });

  it("quiet silences everything except the owner's own event follow-ups", () => {
    expect(shouldRunProactive("event_followup", quiet)).toBe(true);
    expect(shouldRunProactive("checkin", quiet)).toBe(false);
    expect(shouldRunProactive("autonomy", quiet)).toBe(false);
    expect(shouldRunProactive("competitor", quiet)).toBe(false);
  });

  it("report follows the cadence switch", () => {
    expect(shouldRunProactive("report", reportOff)).toBe(false);
    expect(shouldRunProactive("report", balanced)).toBe(true);
  });
});

describe("proactiveBudgetFor", () => {
  it("is 2 for high, 1 otherwise", () => {
    expect(proactiveBudgetFor(readEngagementProfile(brand({ engagement_profile: { proactivity: "high" } } as BusinessFacts)))).toBe(2);
    expect(proactiveBudgetFor(readEngagementProfile(brand({})))).toBe(1);
    expect(proactiveBudgetFor(readEngagementProfile(brand({ engagement_profile: { proactivity: "quiet" } } as BusinessFacts)))).toBe(1);
  });
});

describe("looksLikeEngagementPref", () => {
  it("fires on how-to-talk-to-me phrasing", () => {
    expect(looksLikeEngagementPref("ease off the check-ins")).toBe(true);
    expect(looksLikeEngagementPref("can you send me a morning report at 8")).toBe(true);
    expect(looksLikeEngagementPref("only message me when I message you")).toBe(true);
  });
  it("stays quiet on ordinary work chat", () => {
    expect(looksLikeEngagementPref("make the caption punchier")).toBe(false);
    expect(looksLikeEngagementPref("we're open till 6 now")).toBe(false);
    expect(looksLikeEngagementPref(null)).toBe(false);
  });
});

describe("updateEngagementFromMessage", () => {
  it("persists a proactivity change and returns the confirmation", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ changes: { proactivity: "quiet" }, reply: "Done — I'll keep it quiet." }));
    const reply = await updateEngagementFromMessage(brand({}), "ease off the check-ins");
    expect(reply).toBe("Done — I'll keep it quiet.");
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    const saved = JSON.parse(params[1] as string);
    expect(saved).toMatchObject({ proactivity: "quiet", source: "owner_set" });
    expect(saved.updated_at).toBeTruthy();
  });

  it("merges a report time onto the existing profile without losing other dials", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ changes: { report: { cadence: "daily", hour_local: 7 } }, reply: "Morning reports at 7 it is." }));
    const existing = brand({ engagement_profile: { warmth: "matey", proactivity: "high" } } as BusinessFacts);
    const reply = await updateEngagementFromMessage(existing, "give me a daily report at 7");
    expect(reply).toMatch(/7/);
    const saved = JSON.parse((mockedQuery.mock.calls[0] as [string, unknown[]])[1][1] as string);
    expect(saved).toMatchObject({ warmth: "matey", proactivity: "high", report: { cadence: "daily", hour_local: 7 } });
  });

  it("returns null and writes nothing when the model finds no change", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ changes: {}, reply: "" }));
    expect(await updateEngagementFromMessage(brand({}), "hey")).toBeNull();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("ignores an out-of-range report hour", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ changes: { report: { hour_local: 99 } }, reply: "ok" }));
    // hour_local 99 is the only 'change' and it's invalid → treated as no change.
    expect(await updateEngagementFromMessage(brand({}), "report at 99")).toBeNull();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns null when the model errors", async () => {
    mockedCallLLM.mockRejectedValue(new Error("boom"));
    expect(await updateEngagementFromMessage(brand({}), "ease off")).toBeNull();
  });
});
