import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand, ResearchSnapshot } from "@pulse/shared";

vi.mock("../research.js", () => ({
  listRecentSnapshots: vi.fn(async () => []),
  runDeepResearch: vi.fn(async () => ({ reply: "ok", snapshotId: "snap-1" })),
  detectResearchFocus: vi.fn((body: string) => {
    if (/competitor/i.test(body)) return "competitors";
    if (/niche/i.test(body)) return "niche";
    return null;
  }),
}));

vi.mock("../competitors.js", () => ({
  listCompetitorWatches: vi.fn(async () => []),
}));

vi.mock("../llm.js", () => ({
  callLLM: vi.fn(async () =>
    JSON.stringify({
      ideas: [
        {
          title: "Hiring pattern match",
          angle: "Counter their vague culture ads with a concrete scorecard post",
          format: "carousel",
          why: "Rivals are running soft culture ads — you can one-up with specifics",
          inspired_by: "Competitor Ad Library: culture-first hiring",
        },
        {
          title: "Cold email rewrite",
          angle: "Show the before/after of an AI-tightened outbound",
          format: "feed",
          why: "Fits your AI workflow lane and pain language around wasted time",
        },
        {
          title: "Founder Monday reset",
          angle: "Treat Monday like a new company",
          format: "feed",
          why: "Organic theme already landing with your audience",
        },
      ],
    }),
  ),
  stripMarkdown: (s: string) => s,
}));

import { listCompetitorWatches } from "../competitors.js";
import { callLLM } from "../llm.js";
import { listRecentSnapshots, runDeepResearch } from "../research.js";
import {
  ensureIdeaResearchBank,
  gatherIdeaResearchBank,
  scoutContentIdeas,
} from "../ideaScout.js";

const mockedSnaps = listRecentSnapshots as unknown as ReturnType<typeof vi.fn>;
const mockedWatches = listCompetitorWatches as unknown as ReturnType<typeof vi.fn>;
const mockedDeep = runDeepResearch as unknown as ReturnType<typeof vi.fn>;
const mockedLlm = callLLM as unknown as ReturnType<typeof vi.fn>;

function stubBrand(): Brand {
  return { id: "brand-1", name: "Bill Calder", facts: { owner_name: "bill" } } as Brand;
}

function snap(over: Partial<ResearchSnapshot> = {}): ResearchSnapshot {
  return {
    id: "s1",
    brand_id: "brand-1",
    kind: "competitor",
    subject: "RivalCo",
    summary: "RivalCo is running culture-first hiring ads with soft CTAs.",
    findings: {
      competitor_hooks: ["Join a family"],
      ad_library_angles: ["culture-first hiring"],
      organic_themes: ["team vibes"],
    },
    created_at: "2026-09-17T00:00:00.000Z",
    ...over,
  };
}

describe("gatherIdeaResearchBank", () => {
  beforeEach(() => {
    mockedSnaps.mockReset();
    mockedWatches.mockReset();
    mockedSnaps.mockResolvedValue([]);
    mockedWatches.mockResolvedValue([]);
  });

  it("is thin when there are no snapshots or watch snapshots", async () => {
    const bank = await gatherIdeaResearchBank("brand-1");
    expect(bank.thin).toBe(true);
    expect(bank.snapshotCount).toBe(0);
  });

  it("includes competitor hooks and watch names when present", async () => {
    mockedSnaps.mockResolvedValueOnce([snap()]);
    mockedWatches.mockResolvedValueOnce([
      {
        id: "w1",
        brand_id: "brand-1",
        name: "RivalCo",
        handles: null,
        last_snapshot: "Running three Meta ads on culture.",
        last_watched_at: null,
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ]);
    const bank = await gatherIdeaResearchBank("brand-1");
    expect(bank.thin).toBe(false);
    expect(bank.watchNames).toEqual(["RivalCo"]);
    expect(bank.text).toMatch(/Ad Library angles/i);
    expect(bank.text).toMatch(/RivalCo/);
  });
});

describe("ensureIdeaResearchBank", () => {
  beforeEach(() => {
    mockedSnaps.mockReset();
    mockedWatches.mockReset();
    mockedDeep.mockReset();
    mockedSnaps.mockResolvedValue([]);
    mockedWatches.mockResolvedValue([]);
    mockedDeep.mockResolvedValue({ reply: "ok", snapshotId: "snap-1" });
  });

  it("refreshes via runDeepResearch when the bank is thin", async () => {
    mockedSnaps
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([snap()]);
    const { bank, refreshed } = await ensureIdeaResearchBank(stubBrand(), "come up with suggestions");
    expect(mockedDeep).toHaveBeenCalledTimes(1);
    expect(refreshed).toBe(true);
    expect(bank.thin).toBe(false);
  });

  it("skips refresh when a solid bank already exists and focus is not competitor-shaped", async () => {
    mockedSnaps.mockResolvedValue([snap()]);
    const { refreshed } = await ensureIdeaResearchBank(stubBrand(), "a few post ideas");
    expect(mockedDeep).not.toHaveBeenCalled();
    expect(refreshed).toBe(false);
  });

  it("refreshes on competitor-shaped focus even when a bank exists", async () => {
    mockedSnaps.mockResolvedValue([snap()]);
    await ensureIdeaResearchBank(stubBrand(), "look into competitors");
    expect(mockedDeep).toHaveBeenCalledTimes(1);
    expect(mockedDeep.mock.calls[0]![1]).toBe("competitors");
  });
});

describe("scoutContentIdeas", () => {
  beforeEach(() => {
    mockedSnaps.mockReset();
    mockedWatches.mockReset();
    mockedDeep.mockReset();
    mockedLlm.mockClear();
    mockedSnaps.mockResolvedValue([snap()]);
    mockedWatches.mockResolvedValue([]);
    mockedDeep.mockResolvedValue({ reply: "ok", snapshotId: "snap-1" });
  });

  it("synthesises ideas from the research bank and passes inspired_by through", async () => {
    const out = await scoutContentIdeas(stubBrand(), { focus: "content suggestions", count: 3 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(out.ideas[0]?.inspired_by).toMatch(/Ad Library/i);
    expect(mockedLlm).toHaveBeenCalled();
    const system = String(mockedLlm.mock.calls[0]![0].system);
    expect(system).toMatch(/Research bank/i);
    expect(system).toMatch(/Ad Library|hooks/i);
    expect(system).toMatch(/Never ask clarifying niche questions/i);
  });

  it("falls back to concrete ideas when the LLM returns none", async () => {
    mockedLlm.mockResolvedValueOnce(JSON.stringify({ ideas: [] }));
    const out = await scoutContentIdeas(
      { id: "brand-1", name: "Lab Cafe", facts: { lab: true } } as Brand,
      { focus: "3 post ideas", count: 3 },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(out.ideas.every((i) => i.title && i.angle)).toBe(true);
  });
});

describe("formatIdeasSms / fallbackContentIdeas", () => {
  it("formats a rundown without interview questions", async () => {
    const { formatIdeasSms, fallbackContentIdeas } = await import("../ideaScout.js");
    const ideas = fallbackContentIdeas(
      { id: "b1", name: "Lab Cafe", facts: { lab: true } } as Brand,
      3,
    );
    const sms = formatIdeasSms(ideas, "Are you a specialty coffee spot?");
    expect(sms).toMatch(/1\. /);
    expect(sms).toMatch(/Want me to draft one/);
    expect(sms).not.toMatch(/specialty coffee/);
    expect(sms).not.toMatch(/Are you a/);
  });
});
