import { describe, expect, it } from "vitest";
import type { Post } from "@pulse/shared";
import {
  captionEditMissed,
  formatOfferedDraftBlock,
  looksLikeMetaCaption,
  offeredDraftView,
} from "../offeredDraft.js";

function stubPost(over: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    brand_id: "brand-1",
    caption: "You can spend six figures on the car or six figures on the system.",
    media_ids: ["tiled-1"],
    source_media_ids: ["source-1"],
    style_meta: { wants_text: true, headline: "CAR VS ENGINE", generated: true },
    format: "feed",
    platform: "instagram",
    destinations: ["instagram"],
    status: "pending_approval",
    scheduled_at: "2026-09-18T19:56:00.000Z",
    ...over,
  } as Post;
}

describe("formatOfferedDraftBlock", () => {
  it("makes caption vs on-image text explicit", () => {
    const block = formatOfferedDraftBlock(stubPost());
    expect(block).toMatch(/Caption \(SMS \/ feed copy/);
    expect(block).toMatch(/Text on image: YES/);
    expect(block).toMatch(/CAR VS ENGINE/);
    expect(block).toMatch(/clean source available: yes/i);
    expect(block).toMatch(/AI\/generated/);
    expect(block).toMatch(/set_image_text/);
  });

  it("reports no overlay when wants_text is false", () => {
    const block = formatOfferedDraftBlock(
      stubPost({ style_meta: { wants_text: false, generated: true }, source_media_ids: ["s1"] }),
    );
    expect(block).toMatch(/Text on image: NO/);
  });
});

describe("offeredDraftView", () => {
  it("treats a headline as overlay even without wants_text flag", () => {
    const v = offeredDraftView(stubPost({ style_meta: { headline: "HELLO" } }));
    expect(v.wants_text).toBe(true);
    expect(v.headline).toBe("HELLO");
  });
});

describe("looksLikeMetaCaption", () => {
  it("rejects clarifying / refusal captions", () => {
    expect(
      looksLikeMetaCaption(
        "I can't create a caption with no text. Could you clarify what you'd like instead?",
      ),
    ).toBe(true);
    expect(looksLikeMetaCaption("Six figures on the system compounds.")).toBe(false);
  });
});

describe("captionEditMissed", () => {
  it("flags ignored shorter asks", () => {
    const cap = "A long caption that should get shorter when asked.";
    expect(captionEditMissed("shorter, drop the CTA", cap, cap)).toBe(true);
  });
});
