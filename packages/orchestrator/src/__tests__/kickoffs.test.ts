import { describe, it, expect, vi } from "vitest";
import {
  looksLikeKickoffRequest,
  inferKickoffFromUserMessage,
  inferKickoffFromKipCommit,
  deliverUnstreamed,
} from "../kickoffs.js";

describe("looksLikeKickoffRequest", () => {
  it("catches first-batch / stock / no-photos asks", () => {
    expect(looksLikeKickoffRequest("Can you rerun and draft my first batch")).toBe(true);
    expect(
      looksLikeKickoffRequest(
        "I don't have any photos to send so can you just do either stock or generated?",
      ),
    ).toBe(true);
    expect(looksLikeKickoffRequest("draft me 3 posts")).toBe(true);
  });

  it("ignores plain chat", () => {
    expect(looksLikeKickoffRequest("thanks!")).toBe(false);
    expect(looksLikeKickoffRequest("what do you think of carousels?")).toBe(false);
  });
});

describe("inferKickoffFromUserMessage", () => {
  it("maps stock/no-photos to first_batch with photo visuals", () => {
    const r = inferKickoffFromUserMessage(
      "I don't have any photos so can you just do stock or generated?",
    );
    expect(r?.kind).toBe("first_batch");
    expect(r?.payload.visuals).toBe("generated");
  });

  it("defaults draft posts to photo visuals", () => {
    const r = inferKickoffFromUserMessage("draft me 2 posts");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.visuals).toBe("photo");
  });

  it("honors explicit text-card asks as designed", () => {
    const r = inferKickoffFromUserMessage("draft me 2 posts as text cards please");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.visuals).toBe("designed");
  });

  it("maps draft N posts", () => {
    const r = inferKickoffFromUserMessage("draft me 3 posts");
    expect(r?.kind).toBe("draft_posts");
    expect(r?.payload.count).toBe(3);
  });

  it("maps trend draft asks", () => {
    const r = inferKickoffFromUserMessage("draft something on a trending topic for me");
    expect(r?.kind).toBe("trend_draft");
  });
});

describe("inferKickoffFromKipCommit", () => {
  it("queues when Kip promises a first batch", () => {
    const r = inferKickoffFromKipCommit(
      "I don't have photos — use generated",
      "Absolutely, I'll pull together the first batch of carousels and get them over for approval.",
    );
    expect(r?.kind).toBe("first_batch");
    expect(r?.payload.visuals).toBe("generated");
  });

  it("does not queue on pure acknowledgement", () => {
    const r = inferKickoffFromKipCommit("cool", "Nice one, Bill.");
    expect(r).toBeNull();
  });
});

describe("deliverUnstreamed", () => {
  it("calls deliver for empty-batch failure SMS (so Kip does not go silent)", async () => {
    const deliver = vi.fn(async () => {});
    const results = [
      { brandId: "b1", sms: "Couldn't finish those drafts just then — try again in a moment?" },
    ];
    const out = await deliverUnstreamed(results, deliver);
    expect(out).toEqual(results);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(results[0]);
  });

  it("is a no-op when deliver is omitted", async () => {
    const results = [{ brandId: "b1", sms: "Need pillars before I draft." }];
    await expect(deliverUnstreamed(results)).resolves.toEqual(results);
  });
});
