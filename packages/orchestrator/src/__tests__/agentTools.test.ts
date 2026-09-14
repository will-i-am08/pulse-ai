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

import {
  KIP_AGENT_TOOLS,
  buildBrandProfilePayload,
  captionExcerpt,
  executeAgentTool,
  isValidKickoffKind,
  mergeKipMemoryFact,
  summarizeCalendar,
} from "../agentTools.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

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
      "enqueue_kickoff",
      "get_brand_profile",
      "get_calendar",
      "get_recent_posts",
      "remember_fact",
    ]);
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

  it("summarizeCalendar notes empty days", () => {
    const now = new Date("2026-09-14T10:00:00.000Z");
    const out = JSON.parse(
      summarizeCalendar(
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
      ),
    );
    expect(out.posts).toHaveLength(1);
    expect(out.emptyDays.length).toBe(6);
  });
});

describe("executeAgentTool", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedQuery.mockResolvedValue([]);
    mockedQueryOne.mockResolvedValue(null);
  });

  it("get_brand_profile returns facts text from a stub brand (no DB)", async () => {
    const brand = stubBrand();
    const raw = await executeAgentTool("get_brand_profile", {}, { brand });
    const payload = JSON.parse(raw);
    expect(payload.name).toBe("Sunrise Cafe");
    expect(payload.facts).toMatch(/Sam/);
    expect(payload.facts).toMatch(/7am/);
    expect(payload.connection).toMatch(/Instagram/);
    expect(payload.voiceToneNotes).toMatch(/warm/);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("buildBrandProfilePayload matches get_brand_profile shape", () => {
    const p = buildBrandProfilePayload(stubBrand());
    expect(p.kip_preferences).toEqual([
      { text: "prefer carousels", atISO: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("enqueue_kickoff rejects invalid kind", async () => {
    const raw = await executeAgentTool(
      "enqueue_kickoff",
      { kind: "publish_now" },
      { brand: stubBrand() },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid kind/);
    expect(mockedQueryOne).not.toHaveBeenCalled();
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

  it("enqueue_kickoff queues a valid kind", async () => {
    mockedQueryOne.mockResolvedValue({
      id: "kick-1",
      brand_id: "brand-1",
      kind: "draft_posts",
      status: "queued",
    });
    const raw = await executeAgentTool(
      "enqueue_kickoff",
      { kind: "draft_posts", payload: { count: 2 } },
      { brand: stubBrand(), sourceMessageId: "msg-1" },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.alreadyQueued).toBe(false);
    expect(result.kickoffId).toBe("kick-1");
    expect(result.note).toMatch(/never auto-publishes/i);
  });
});
