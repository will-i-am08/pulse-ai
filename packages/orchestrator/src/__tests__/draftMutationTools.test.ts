import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand, Post } from "@pulse/shared";
import { query, queryOne } from "@pulse/shared";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

vi.mock("../imaging.js", () => ({
  applyTextTile: vi.fn(async () => "tiled-new"),
  editImageForBrand: vi.fn(async () => "edited-1"),
  generateHeadline: vi.fn(async () => "NEW HEAD"),
}));

vi.mock("../mockup.js", () => ({
  previewUrlForPost: vi.fn(async () => "https://example.com/preview.jpg"),
}));

vi.mock("../applyCorrection.js", () => ({
  applyCorrection: vi.fn(async () => undefined),
}));

vi.mock("../destinations.js", () => ({
  persistEditedCaptions: vi.fn(async () => ({})),
}));

vi.mock("../kickoffs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kickoffs.js")>();
  return {
    ...actual,
    enqueueKickoff: vi.fn(async () => ({
      kickoff: { id: "kick-1" },
      alreadyQueued: false,
      ackSms: "On it — drafting.",
    })),
  };
});

import { executeAgentTool } from "../agentTools.js";
import { applyTextTile } from "../imaging.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedTile = applyTextTile as unknown as ReturnType<typeof vi.fn>;

function stubBrand(): Brand {
  return {
    id: "brand-1",
    name: "Bill Calder",
    approver: "client",
    facts: {},
  } as Brand;
}

function pendingPost(over: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    brand_id: "brand-1",
    caption: "Six figures on the system compounds.",
    media_ids: ["tiled-1"],
    source_media_ids: ["source-1"],
    style_meta: { wants_text: true, headline: "CAR VS ENGINE", generated: true },
    format: "feed",
    platform: "instagram",
    destinations: ["instagram"],
    status: "pending_approval",
    ...over,
  } as Post;
}

describe("draft mutation tools", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQueryOne.mockReset();
    mockedTile.mockClear();
    mockedQuery.mockResolvedValue([]);
    mockedQueryOne.mockResolvedValue(pendingPost());
  });

  it("set_image_text enabled=false restores source and does not re-tile", async () => {
    const lastMediaUrl: { url?: string | null } = {};
    const raw = await executeAgentTool(
      "set_image_text",
      { enabled: false },
      { brand: stubBrand(), lastMediaUrl },
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.wants_text).toBe(false);
    expect(mockedTile).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalled();
    const updateCall = mockedQuery.mock.calls.find((c) => String(c[0]).includes("update posts set media_ids"));
    expect(updateCall?.[1]?.[0]).toEqual(["source-1"]);
    expect(lastMediaUrl.url).toBe("https://example.com/preview.jpg");
  });

  it("get_offered_draft describes overlay vs caption", async () => {
    const raw = await executeAgentTool("get_offered_draft", {}, { brand: stubBrand() });
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.draft).toMatch(/Text on image: YES/);
    expect(result.draft).toMatch(/Caption \(SMS/);
  });

  it("reject_draft marks pending rejected", async () => {
    const raw = await executeAgentTool("reject_draft", {}, { brand: stubBrand() });
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(String(mockedQuery.mock.calls[0]?.[0])).toMatch(/status = 'rejected'/);
  });
});
