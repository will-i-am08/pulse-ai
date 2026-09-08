import { describe, it, expect, vi } from "vitest";
import type { Brand, GbpReview } from "@pulse/shared";
import { formatReviewText, runReviewSync } from "./reviewSync.js";
import type { ReviewSyncDeps } from "./reviewSync.js";

function fakeBrand(): Brand {
  return {
    id: "brand-1",
    name: "Test Brand",
    client_phone: "+61400000000",
    discord_channel_id: null,
    discord_user_id: null,
    owner_user_id: null,
    account_type: null,
    website: null,
    onboarding_state: { status: "none" as const },
    brand_voice_profile: {
      tone: [],
      dos: [],
      donts: [],
      example_captions: [],
      banned_words: [],
      emoji_policy: "sparing",
      hashtag_policy: "",
      notes: [],
    },
    ig_user_id: null,
    fb_page_id: null,
    fb_page_name: null,
    ig_username: null,
    platform_tokens_encrypted: null,
    platform_user_token_encrypted: null,
    meta_connected_at: null,
    google_tokens_encrypted: "encrypted",
    gbp_account: "accounts/1",
    gbp_location_id: "locations/2",
    gbp_location_name: null,
    google_connected_at: null,
    facts: {},
    visual: {},
    approver: "operator",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function fakeReview(overrides: Partial<GbpReview> = {}): GbpReview {
  return {
    reviewId: "review-1",
    name: "accounts/1/locations/2/reviews/review-1",
    reviewer: "A customer",
    starRating: "FIVE",
    comment: "great spot, will be back!",
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<ReviewSyncDeps> = {}) {
  const deps: ReviewSyncDeps = {
    listGoogleBrands: vi.fn().mockResolvedValue([fakeBrand()]),
    fetchReviews: vi.fn().mockResolvedValue([fakeReview()]),
    isSeen: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({ id: "interaction-1" }),
    ...overrides,
  };
  return deps;
}

describe("formatReviewText", () => {
  it("prefixes the star rating", () => {
    expect(formatReviewText(fakeReview())).toBe("(5★) great spot, will be back!");
  });

  it("defaults unknown ratings to 3 stars", () => {
    expect(formatReviewText(fakeReview({ starRating: "WEIRD" }))).toBe("(3★) great spot, will be back!");
  });
});

describe("runReviewSync", () => {
  it("ingests unseen reviews into triage", async () => {
    const deps = fakeDeps();
    await runReviewSync(deps);
    expect(deps.create).toHaveBeenCalledOnce();
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brand-1" }),
      {
        platform: "google",
        kind: "review",
        author: "A customer",
        text: "(5★) great spot, will be back!",
        external_id: "accounts/1/locations/2/reviews/review-1",
      },
    );
  });

  it("skips already-seen reviews", async () => {
    const deps = fakeDeps({ isSeen: vi.fn().mockResolvedValue(true) });
    await runReviewSync(deps);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("keeps going when one brand's fetch fails", async () => {
    const brand2 = { ...fakeBrand(), id: "brand-2" };
    const deps = fakeDeps({
      listGoogleBrands: vi.fn().mockResolvedValue([fakeBrand(), brand2]),
      fetchReviews: vi
        .fn()
        .mockRejectedValueOnce(new Error("google down"))
        .mockResolvedValueOnce([fakeReview({ reviewId: "review-2" })]),
    });
    await runReviewSync(deps);
    expect(deps.create).toHaveBeenCalledOnce();
  });
});
