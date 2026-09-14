import { describe, expect, it } from "vitest";
import { refersToAttachedMedia } from "./gateway.js";

describe("refersToAttachedMedia", () => {
  it("catches Bill's morning phrasing", () => {
    expect(refersToAttachedMedia("Post a good morning post with this photo")).toBe(true);
  });

  it("ignores plain creative asks without a photo reference", () => {
    expect(refersToAttachedMedia("make me a post about hiring")).toBe(false);
    expect(refersToAttachedMedia("thanks!")).toBe(false);
  });
});
