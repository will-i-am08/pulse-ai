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

beforeEach(() => mockedQuery.mockReset());
function committed(rows: Array<{ scheduled_at: string; pillar_id: string | null }>) {
  mockedQuery.mockResolvedValue(rows);
}

describe("scheduleSlot guardrails", () => {
  it("returns the next platform window in the future when the calendar is empty", async () => {
    committed([]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now });
    expect(slot.getTime()).toBeGreaterThan(now.getTime());
    expect(IG_WINDOWS).toContain(slot.getHours());
    expect(slot.getHours()).toBe(11); // first window after 08:00
  });

  it("respects minimum spacing — won't slot within 3h of an existing post", async () => {
    committed([{ scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "other" }]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now });
    // 11:00 taken, 13:00 is only 2h away → skipped, 19:00 is the next valid slot.
    expect(slot.getHours()).toBe(19);
  });

  it("respects the daily cap — a full day pushes to the next day", async () => {
    // All three of today's windows already taken → the day is at the cap of 3.
    committed([
      { scheduled_at: new Date(2026, 8, 7, 11, 0, 0).toISOString(), pillar_id: "x" },
      { scheduled_at: new Date(2026, 8, 7, 13, 0, 0).toISOString(), pillar_id: "y" },
      { scheduled_at: new Date(2026, 8, 7, 19, 0, 0).toISOString(), pillar_id: "z" },
    ]);
    const slot = await scheduleSlot({ brandId: "b1", platform: "instagram", pillarId: null, postsPerWeek: 0, now });
    expect(slot.getDate()).toBe(8); // next day
    expect(slot.getHours()).toBe(11);
  });
});
