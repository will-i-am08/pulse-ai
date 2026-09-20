import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: (sql: string, params?: unknown[]) => queryMock(sql, params),
    queryOne: (sql: string, params?: unknown[]) => queryOneMock(sql, params),
  };
});

vi.mock("../visualMode.js", () => ({
  resolveVisualMode: () => "photo",
  visualsPayloadValue: (m: string) => m,
  withPreferredVisuals: (v: unknown) => v,
  inferVisualModeFromText: () => "photo",
}));

import {
  kickoffBriefKey,
  enqueueKickoff,
  cancelActiveKickoffs,
  kickoffStillRunning,
} from "../kickoffs.js";
import type { Brand } from "@pulse/shared";

const BRAND = { id: "brand-1", name: "Lab", visual: {} } as unknown as Brand;

describe("kickoffBriefKey", () => {
  it("matches identical briefs and differs on topic / destinations", () => {
    const a = kickoffBriefKey({
      topicHint: "Draft a LinkedIn post about hiring a barista",
      count: 1,
      destinations: ["linkedin"],
    });
    const b = kickoffBriefKey({
      topicHint: "Draft a LinkedIn post about hiring a barista",
      count: 1,
      destinations: ["linkedin"],
    });
    const c = kickoffBriefKey({
      topicHint: "Make one square graphic (not a carousel) with exact overlay",
      count: 1,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("enqueueKickoff supersede", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    // rememberPreferredVisuals persists preferred_visuals on first draft ask.
    queryMock.mockResolvedValue([]);
  });

  it("returns alreadyQueued when the active brief is the same", async () => {
    const payload = { topicHint: "draft me a post about hiring", count: 1, visuals: "photo" };
    queryOneMock
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "idx_kip_kickoffs_active_brand_kind"'),
      )
      .mockResolvedValueOnce({
        id: "k-old",
        brand_id: BRAND.id,
        kind: "draft_posts",
        status: "running",
        payload,
      });

    const out = await enqueueKickoff(BRAND, "draft_posts", {
      payload,
      reason: "user_request",
      ackSms: "On it — drafting that post from your brief now.",
    });
    expect(out.alreadyQueued).toBe(true);
    expect(out.kickoff).toBeNull();
    expect(out.ackSms).toMatch(/Already on that/i);
    expect(queryMock.mock.calls.some(([sql]) => /status = 'cancelled'/.test(String(sql)))).toBe(
      false,
    );
  });

  it("cancels the active kickoff and enqueues when the brief changed", async () => {
    const oldPayload = {
      topicHint: "Draft something in my lane.",
      count: 2,
      visuals: "photo",
    };
    const newPayload = {
      topicHint: "Draft a LinkedIn post about hiring a barista — professional tone, photo please",
      count: 1,
      destinations: ["linkedin"],
      visuals: "photo",
    };
    const inserted = {
      id: "k-new",
      brand_id: BRAND.id,
      kind: "draft_posts",
      status: "queued",
      payload: newPayload,
    };

    queryOneMock
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "idx_kip_kickoffs_active_brand_kind"'),
      )
      .mockResolvedValueOnce({
        id: "k-old",
        brand_id: BRAND.id,
        kind: "draft_posts",
        status: "running",
        payload: oldPayload,
      })
      .mockResolvedValueOnce(inserted);

    queryMock
      .mockResolvedValueOnce([]) // rememberPreferredVisuals
      .mockResolvedValueOnce([{ id: "k-old" }]); // cancelActiveKickoffs

    const out = await enqueueKickoff(BRAND, "draft_posts", {
      payload: newPayload,
      reason: "user_request",
      ackSms: "On it — drafting that post from your brief now.",
    });

    expect(out.alreadyQueued).toBe(false);
    expect(out.kickoff?.id).toBe("k-new");
    expect(out.ackSms).toMatch(/On it/i);
    expect(queryMock.mock.calls.some(([sql]) => /status = 'cancelled'/.test(String(sql)))).toBe(
      true,
    );
  });
});

describe("cancelActiveKickoffs / kickoffStillRunning", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
  });

  it("cancelActiveKickoffs updates queued and running rows", async () => {
    queryMock.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    const n = await cancelActiveKickoffs(BRAND.id, "draft_posts");
    expect(n).toBe(2);
    expect(queryMock.mock.calls[0]![0]).toMatch(/status in \('queued', 'running'\)/);
  });

  it("kickoffStillRunning is true only for running", async () => {
    queryOneMock.mockResolvedValueOnce({ status: "running" });
    expect(await kickoffStillRunning("k1")).toBe(true);
    queryOneMock.mockResolvedValueOnce({ status: "cancelled" });
    expect(await kickoffStillRunning("k1")).toBe(false);
    queryOneMock.mockResolvedValueOnce(null);
    expect(await kickoffStillRunning("k1")).toBe(true);
  });
});
