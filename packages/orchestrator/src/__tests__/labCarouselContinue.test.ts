import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@pulse/shared", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import { query } from "@pulse/shared";
import { requeueStaleKickoffs } from "../kickoffs.js";

describe("requeueStaleKickoffs", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue([{ id: "k1" }, { id: "k2" }] as never);
  });

  it("requeues abandoned running kickoffs for a brand", async () => {
    const ids = await requeueStaleKickoffs({
      brandId: "brand-lab",
      staleMs: 45_000,
      now: new Date("2026-09-20T09:00:00.000Z"),
    });
    expect(ids).toEqual(["k1", "k2"]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(query).mock.calls[0]!;
    expect(String(sql)).toMatch(/status = 'queued'/);
    expect(String(sql)).toMatch(/started_at = null/);
    expect(params?.[1]).toBe("brand-lab");
  });
});

describe("generatePhotoTextCarousel Lab budget (source)", () => {
  const formats = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../formats.ts"),
    "utf8",
  );
  const photo = formats.slice(
    formats.indexOf("export async function generatePhotoTextCarousel"),
    formats.indexOf("export async function generateTipCarousel"),
  );

  it("pins still chain to nano_banana and caps recomposes", () => {
    expect(photo).toMatch(/stillIds:\s*\["nano_banana"\]/);
    expect(photo).toMatch(/maxRecomposes:\s*1/);
    expect(photo).toMatch(/soft QA remainders after recompose — shipping/);
  });
});
