import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, queryOne: vi.fn(async () => null) };
});

import { queryOne } from "@pulse/shared";
import { hasApprovedLog } from "./assertApproved.js";

const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQueryOne.mockReset();
});

describe("hasApprovedLog (X1 — approval is absolute)", () => {
  it("returns true when an approved approval_log row exists", async () => {
    mockedQueryOne.mockResolvedValueOnce({ id: "log-1" });
    expect(await hasApprovedLog("post-1")).toBe(true);
    expect(mockedQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("approval_log"),
      ["post-1", "approved"],
    );
  });

  it("returns false when no approved row exists — publish must skip", async () => {
    mockedQueryOne.mockResolvedValueOnce(null);
    expect(await hasApprovedLog("post-2")).toBe(false);
  });
});
