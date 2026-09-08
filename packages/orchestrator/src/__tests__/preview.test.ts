import { describe, it, expect, vi } from "vitest";
import { previewUrlForPost, type MockupInput } from "../mockup.js";
import { publicMediaUrl, type Brand } from "@pulse/shared";

const brand = {
  id: "brand-1",
  name: "Pulse Social",
  ig_username: "pulsesocial",
  visual: { aspect_ratio: "4:5" },
} as unknown as Brand;

const feedPost = { caption: "Fresh from the shoot", format: "feed" as const, media_ids: ["photo-1"] };
const photoBytes = { bytes: Buffer.from([1, 2, 3]), contentType: "image/jpeg" };

function deps(overrides: Record<string, unknown> = {}) {
  return {
    fetchMedia: vi.fn(async () => photoBytes),
    renderFeed: vi.fn(async (_bytes: Uint8Array, _input: MockupInput) => Buffer.from("feed-mockup")),
    renderStory: vi.fn(async (_bytes: Uint8Array, _input: MockupInput) => Buffer.from("story-mockup")),
    store: vi.fn(async () => "mockup-1"),
    ...overrides,
  };
}

describe("previewUrlForPost", () => {
  it("falls back to the original photo URL when rendering throws", async () => {
    const d = deps({ renderFeed: vi.fn(async () => { throw new Error("satori blew up"); }) });
    const url = await previewUrlForPost(brand, feedPost, "photo-1", d);
    expect(url).toBe(publicMediaUrl("photo-1"));
    expect(d.store).not.toHaveBeenCalled();
  });

  it("falls back to the original photo URL when the photo bytes are missing", async () => {
    const d = deps({ fetchMedia: vi.fn(async () => null) });
    const url = await previewUrlForPost(brand, feedPost, "photo-1", d);
    expect(url).toBe(publicMediaUrl("photo-1"));
    expect(d.renderFeed).not.toHaveBeenCalled();
  });

  it("falls back to the original photo URL when storing throws", async () => {
    const d = deps({ store: vi.fn(async () => { throw new Error("db down"); }) });
    const url = await previewUrlForPost(brand, feedPost, "photo-1", d);
    expect(url).toBe(publicMediaUrl("photo-1"));
  });

  it("renders the feed frame and returns the stored mockup URL on success", async () => {
    const d = deps();
    const url = await previewUrlForPost(brand, feedPost, "photo-1", d);
    expect(url).toBe(publicMediaUrl("mockup-1"));
    expect(d.fetchMedia).toHaveBeenCalledWith("photo-1");
    expect(d.renderFeed).toHaveBeenCalledTimes(1);
    expect(d.renderStory).not.toHaveBeenCalled();
    const input = d.renderFeed.mock.calls[0]![1] as MockupInput;
    expect(input.brandName).toBe("Pulse Social");
    expect(input.igUsername).toBe("pulsesocial");
    expect(input.caption).toBe("Fresh from the shoot");
    expect(input.aspectRatio).toBe("4:5");
    expect(d.store).toHaveBeenCalledWith("brand-1", expect.any(Buffer));
  });

  it("uses the story renderer for story posts", async () => {
    const d = deps();
    const url = await previewUrlForPost(
      brand,
      { caption: "candid", format: "story", media_ids: ["photo-9"] },
      "photo-9",
      d,
    );
    expect(url).toBe(publicMediaUrl("mockup-1"));
    expect(d.renderStory).toHaveBeenCalledTimes(1);
    expect(d.renderFeed).not.toHaveBeenCalled();
  });

  it("passes slideCount = media_ids.length for carousels, 1 for feed", async () => {
    const d = deps();
    await previewUrlForPost(brand, { caption: "x", format: "carousel", media_ids: ["a", "b", "c"] }, "a", d);
    expect((d.renderFeed.mock.calls[0]![1] as MockupInput).slideCount).toBe(3);

    const d2 = deps();
    // Feed drafts can carry a styled copy next to the original — still one frame, no pip.
    await previewUrlForPost(brand, { caption: "x", format: "feed", media_ids: ["styled", "orig"] }, "styled", d2);
    expect((d2.renderFeed.mock.calls[0]![1] as MockupInput).slideCount).toBe(1);
  });
});
