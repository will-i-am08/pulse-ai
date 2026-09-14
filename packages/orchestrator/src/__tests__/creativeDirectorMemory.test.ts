import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@pulse/shared";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => [
      {
        id: "mem-1",
        brand_id: "b1",
        media_id: "m1",
        post_id: "p1",
        kind: "creative",
        status: "approved",
        notes: null,
        score: null,
        created_at: new Date().toISOString(),
      },
    ]),
    queryOne: vi.fn(async () => null),
  };
});

import {
  buildApprovedCreativeMemoryNotes,
  recordApprovedCreativeMemory,
} from "../designMemory.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe("recordApprovedCreativeMemory", () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue([
      {
        id: "mem-1",
        brand_id: "b1",
        media_id: "m1",
        post_id: "p1",
        kind: "creative",
        status: "approved",
        notes: null,
        score: null,
        created_at: new Date().toISOString(),
      },
    ]);
  });

  it("notes include source and style flags", () => {
    const notes = buildApprovedCreativeMemoryNotes({
      post: {
        caption: "Morning flat white special",
        style_meta: { photo_carousel: true, researched_ideas: true },
      },
      source: "sms",
    });
    expect(notes.length).toBeLessThanOrEqual(200);
    expect(notes).toContain("sms");
    expect(notes).toContain("photo_carousel");
    expect(notes).toContain("researched_ideas");
    expect(notes).toMatch(/Morning flat white/);
  });

  it("stores cover only for short carousels / feed", async () => {
    await recordApprovedCreativeMemory({
      brandId: "brand-1",
      source: "dashboard",
      post: {
        id: "post-1",
        format: "feed",
        caption: "hello world",
        media_ids: ["m-cover", "m-2"],
        style_meta: {},
      },
    });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const params = mockedQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("brand-1");
    expect(params[1]).toBe("m-cover");
    expect(params[2]).toBe("post-1");
    expect(params[3]).toBe("creative");
    expect(params[4]).toBe("approved");
    expect(String(params[5])).toContain("dashboard");
  });

  it("stores cover + mid slide for carousel with >=3 media", async () => {
    await recordApprovedCreativeMemory({
      brandId: "brand-1",
      source: "sms",
      post: {
        id: "post-2",
        format: "carousel",
        caption: "carousel caption",
        media_ids: ["a", "b", "c", "d", "e"],
        style_meta: { photo_carousel: true },
      },
    });
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]![1][1]).toBe("a");
    expect(mockedQuery.mock.calls[1]![1][1]).toBe("c"); // floor(5/2) = 2
    expect(mockedQuery.mock.calls[0]![1][3]).toBe("carousel_slide");
    expect(String(mockedQuery.mock.calls[0]![1][5])).toContain("sms");
  });

  it("no-ops without media and does not throw on store failure", async () => {
    await expect(
      recordApprovedCreativeMemory({
        brandId: "brand-1",
        source: "calendar",
        post: { id: "p", media_ids: [] },
      }),
    ).resolves.toBeUndefined();
    expect(mockedQuery).not.toHaveBeenCalled();

    mockedQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordApprovedCreativeMemory({
        brandId: "brand-1",
        source: "sms",
        post: { id: "p", format: "story", media_ids: ["m1"] },
      }),
    ).resolves.toBeUndefined();
  });
});
