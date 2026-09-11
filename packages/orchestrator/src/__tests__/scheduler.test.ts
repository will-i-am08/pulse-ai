import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB so scheduleSlot's "committed posts" lookup returns what we control.
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []) };
});

import { query } from "@pulse/shared";
import { scheduleSlot } from "../scheduler.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const IG_WINDOWS = [11, 13, 19];
const now = new Date(2026, 8, 7, 8, 0, 0); // Mon 7 Sep 2026, 08:00 local

// Order-preserving stub: Fisher-Yates stays identity, minutes land on :59.
const steady = () => 0.999999;

beforeEach(() => mockedQuery.mockReset());
function committed(rows: Array<{ scheduled_at: string; pillar_id: string | null; format?: string | null }>) {
  mockedQuery.mockResolvedValue(rows);
}

describe("scheduleSlot guardrails", () => {
  it("returns the next platform window in the future when the calendar is empty", async () => {
    committed([]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now, random: steady });
    expect(slot.getTime()).toBeGreaterThan(now.getTime());
    expect(IG_WINDOWS).toContain(slot.getHours());
    expect(slot.getHours()).toBe(11); // first window after 08:00 (shuffle disabled via stub)
    expect(slot.getMinutes()).toBe(59); // jitter applied
  });

  it("respects minimum spacing — won't slot within 3h of an existing post", async () => {
    committed([{ scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "other" }]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now, random: steady });
    // 11:59 is within 3h of 11:00 → skipped; 13:59 is 2h59 away → skipped; 19:59 wins.
    expect(slot.getHours()).toBe(19);
  });

  it("respects the daily cap — a full day pushes to the next day", async () => {
    // All three of today's windows already taken → the day is at the cap of 3.
    committed([
      { scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "x" },
      { scheduled_at: new Date(2026, 8, 7, 13, 0, 0).toISOString(), pillar_id: "y" },
      { scheduled_at: new Date(2026, 8, 7, 19, 0, 0).toISOString(), pillar_id: "z" },
    ]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now, random: steady });
    expect(slot.getDate()).toBe(8); // next day
    expect(slot.getHours()).toBe(11);
  });

  it("skips a day that already has the same format (calendar conflict)", async () => {
    // One carousel already on Mon → another carousel should land Tuesday (spacing OK on Mon 19 but format blocks the day).
    committed([
      { scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "x", format: "carousel" },
    ]);
    const slot = await scheduleSlot({
      brandId: "b1",
      platform: "instagram",
      pillarId: null,
      postsPerWeek: 0,
      format: "carousel",
      now,
      random: steady,
    });
    expect(slot.getDate()).toBe(8);
    expect(slot.getHours()).toBe(11);
  });

  it("allows a different format on the same day", async () => {
    committed([
      { scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "x", format: "carousel" },
    ]);
    const slot = await scheduleSlot({
      brandId: "b1",
      platform: "instagram",
      pillarId: null,
      postsPerWeek: 0,
      format: "feed",
      now,
      random: steady,
    });
    // 11:00 taken by spacing → 13:59 or 19:59; steady shuffle keeps order so 13 blocked by spacing, 19 wins.
    expect(slot.getDate()).toBe(7);
    expect(slot.getHours()).toBe(19);
  });
});

describe("scheduleSlot variation", () => {
  it("applies minute jitter from the random source", async () => {
    committed([]);
    const slotZero = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now, random: () => 0 });
    expect(slotZero.getMinutes()).toBe(0);
    const slotHalf = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now, random: () => 0.5 });
    expect(slotHalf.getMinutes()).toBe(30);
  });

  it("shuffles window order — the same empty calendar doesn't always fill the same hour", async () => {
    committed([]);
    const hours = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now });
      expect(IG_WINDOWS).toContain(slot.getHours());
      hours.add(slot.getHours());
    }
    expect(hours.size).toBeGreaterThan(1);
  });

  it("keeps guardrails honest with jitter — jittered slots still honour spacing", async () => {
    committed([{ scheduled_at: new Date(2026, 8, 7, 11, 30, 0).toISOString(), pillar_id: "other" }]);
    for (let i = 0; i < 20; i++) {
      const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now });
      const gap = Math.abs(slot.getTime() - new Date(2026, 8, 7, 11, 30, 0).getTime());
      expect(gap).toBeGreaterThanOrEqual(3 * 3600_000);
    }
  });
});

describe("scheduleSlot pinned slots", () => {
  it("posts at the exact pinned day+time with no jitter", async () => {
    committed([]);
    const slot = await scheduleSlot({
      brandId: "b1",
      platform: "instagram",
      pillarId: "p1",
      postsPerWeek: 1,
      now, // Mon 7 Sep 2026 08:00
      pin: { mode: "weekly", weekdays: [2], monthDays: [], hour: 18, minute: 0 },
    });
    expect(slot.getDay()).toBe(2); // Tuesday
    expect(slot.getDate()).toBe(8);
    expect(slot.getHours()).toBe(18);
    expect(slot.getMinutes()).toBe(0);
  });

  it("a monthly pin lands on the pinned date at the exact time", async () => {
    committed([]);
    const slot = await scheduleSlot({
      brandId: "b1",
      platform: "instagram",
      pillarId: "p1",
      postsPerWeek: 1,
      now,
      pin: { mode: "monthly", weekdays: [], monthDays: [1], hour: 9, minute: 30 },
    });
    expect(slot.getDate()).toBe(1);
    expect(slot.getMonth()).toBe(9); // October (0-indexed)
    expect(slot.getHours()).toBe(9);
    expect(slot.getMinutes()).toBe(30);
  });

  it("skips a blocked pinned day for the next matching one", async () => {
    // Tuesday 8 Sep already at the daily cap → pin rolls to Tue 15 Sep.
    committed([
      { scheduled_at: new Date(2026, 8, 8, 9, 0, 0).toISOString(), pillar_id: "x" },
      { scheduled_at: new Date(2026, 8, 8, 13, 0, 0).toISOString(), pillar_id: "y" },
      { scheduled_at: new Date(2026, 8, 8, 18, 5, 0).toISOString(), pillar_id: "z" },
    ]);
    const slot = await scheduleSlot({
      brandId: "b1",
      platform: "instagram",
      pillarId: "p1",
      postsPerWeek: 2,
      now,
      pin: { mode: "weekly", weekdays: [2], monthDays: [], hour: 18, minute: 0 },
    });
    expect(slot.getDay()).toBe(2);
    expect(slot.getDate()).toBe(15);
    expect(slot.getHours()).toBe(18);
    expect(slot.getMinutes()).toBe(0);
  });

  it("loads the pin from the pillar when not passed explicitly", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("schedule_pin")) {
        return [{ schedule_pin: { mode: "weekly", weekdays: [2], monthDays: [], hour: 18, minute: 0 } }];
      }
      return [];
    });
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: "p1", postsPerWeek: 1, now });
    expect(slot.getDay()).toBe(2);
    expect(slot.getHours()).toBe(18);
    expect(slot.getMinutes()).toBe(0);
  });

  it("falls back to shuffled windows when the pillar has no pin", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("schedule_pin")) return [{}];
      return [];
    });
    const hours = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: "p1", postsPerWeek: 0, now });
      hours.add(slot.getHours());
    }
    expect(hours.size).toBeGreaterThan(1);
  });
});
