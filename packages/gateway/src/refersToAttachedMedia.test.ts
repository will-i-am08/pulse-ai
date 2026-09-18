import { describe, expect, it } from "vitest";
import { refersToAttachedMedia } from "./gateway.js";

describe("refersToAttachedMedia", () => {
  it("catches Bill's morning phrasing", () => {
    expect(refersToAttachedMedia("Post a good morning post with this photo")).toBe(true);
  });

  it("catches use-this briefs (incl. typo 'use this a')", () => {
    expect(refersToAttachedMedia("Use this and do something inspirational")).toBe(true);
    expect(refersToAttachedMedia("Use this a do something inspirational")).toBe(true);
    expect(refersToAttachedMedia("use this")).toBe(true);
    expect(refersToAttachedMedia("use these")).toBe(true);
  });

  it("catches explicit prior-send phrasing", () => {
    expect(refersToAttachedMedia("Could you use the photo I sent you?")).toBe(true);
    expect(refersToAttachedMedia("inspirational on this photo")).toBe(true);
  });

  it("ignores overlay edits that mention the image without an attach", () => {
    expect(refersToAttachedMedia("I mean no text on the image")).toBe(false);
    expect(refersToAttachedMedia("put text on the image")).toBe(false);
    expect(refersToAttachedMedia("remove the text on the photo")).toBe(false);
  });

  it("ignores plain creative asks without a photo reference", () => {
    expect(refersToAttachedMedia("make me a post about hiring")).toBe(false);
    expect(refersToAttachedMedia("Generate the photo")).toBe(false);
    expect(refersToAttachedMedia("something inspirational")).toBe(false);
    expect(refersToAttachedMedia("thanks!")).toBe(false);
  });
});
