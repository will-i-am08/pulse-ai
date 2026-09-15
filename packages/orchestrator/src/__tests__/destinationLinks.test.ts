import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Brand, LinkOffer } from "@pulse/shared";

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  };
});

import { query } from "@pulse/shared";
import {
  resolveDestinationLink,
  resolveAdDestinationUrl,
  discoverBookingLinks,
  ensureDestinationLink,
  handleDestinationLinkConfirmation,
  applyLinkOfferToCaption,
  buildLinkOffer,
  matchesLinkOfferRequest,
  looksLikeDestinationLinkIntent,
  looksLikeLinkConfirmYes,
  extractUrlFromMessage,
  platformForbidsCaptionUrl,
  storyLinkCta,
  confirmationSms,
} from "../destinationLinks.js";

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

const brandBase = {
  id: "b1",
  name: "Demo Salon",
  website: "https://demosalon.example",
  facts: {},
  offers: {},
} as unknown as Brand;

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("resolveDestinationLink", () => {
  it("prefers facts.booking_link over offers", () => {
    const brand = {
      ...brandBase,
      facts: { booking_link: "https://facts.example/book" },
      offers: { booking_link: "https://offers.example/book" },
    } as unknown as Brand;
    expect(resolveDestinationLink(brand)).toBe("https://facts.example/book");
  });

  it("falls back to offers.booking_link", () => {
    const brand = {
      ...brandBase,
      facts: {},
      offers: { booking_link: "https://offers.example/book" },
    } as unknown as Brand;
    expect(resolveDestinationLink(brand)).toBe("https://offers.example/book");
  });
});

describe("resolveAdDestinationUrl", () => {
  it("prefers booking then website", () => {
    expect(
      resolveAdDestinationUrl({
        ...brandBase,
        facts: { booking_link: "https://book.example/" },
      } as unknown as Brand),
    ).toBe("https://book.example/");
    expect(resolveAdDestinationUrl(brandBase)).toMatch(/^https:\/\/demosalon\.example\/?$/);
  });
});

describe("discoverBookingLinks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/book")) {
        return htmlResponse(
          `<html><a href="https://calendly.com/demo/30min">Book now</a></html>`,
        );
      }
      return htmlResponse(
        `<html><a href="/book">Schedule</a><a href="https://example.com/about">About</a></html>`,
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("finds Calendly and book-path links", async () => {
    const found = await discoverBookingLinks("https://demosalon.example");
    expect(found.some((f) => f.url.includes("calendly.com"))).toBe(true);
    expect(found[0]!.score).toBeGreaterThan(0);
  });

  it("returns empty for blocked hosts", async () => {
    const found = await discoverBookingLinks("http://127.0.0.1/");
    expect(found).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("ensureDestinationLink + confirmation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue([]);
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(`<html><a href="https://calendly.com/x/y">Book now</a></html>`),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("asks for confirmation when discovering a link", async () => {
    const result = await ensureDestinationLink(brandBase, "post");
    expect(result.url).toBeNull();
    expect(result.askSms).toMatch(/right link/i);
    expect(result.askSms).toMatch(/https?:\/\/\S+/);
    expect(mockedQuery).toHaveBeenCalled();
  });

  it("returns existing confirmed link without SMS", async () => {
    const brand = {
      ...brandBase,
      facts: { booking_link: "https://book.example/" },
    } as unknown as Brand;
    const result = await ensureDestinationLink(brand, "post");
    expect(result.url).toMatch(/^https:\/\/book\.example\/?$/);
    expect(result.askSms).toBeNull();
  });

  it("confirms pending link on yes", async () => {
    const brand = {
      ...brandBase,
      facts: {
        pending_destination_link: {
          url: "https://calendly.com/x",
          context: "post",
          requested_at: new Date().toISOString(),
        },
      },
    } as unknown as Brand;

    const result = await handleDestinationLinkConfirmation(brand, "yes");
    expect(result?.confirmedUrl).toBe("https://calendly.com/x");
    expect(result?.brand.facts?.booking_link).toMatch(/calendly\.com\/x/);
    expect(result?.brand.offers?.booking_link).toMatch(/calendly\.com\/x/);
    expect(mockedQuery).toHaveBeenCalled();
  });

  it("accepts a corrected URL (re-asks confirm)", async () => {
    const brand = {
      ...brandBase,
      facts: {
        pending_destination_link: {
          url: "https://wrong.example/",
          context: "post",
          requested_at: new Date().toISOString(),
        },
      },
    } as unknown as Brand;

    const result = await handleDestinationLinkConfirmation(
      brand,
      "actually https://right.example/book",
    );
    expect(result?.confirmedUrl).toBeNull();
    expect(result?.reply).toMatch(/right\.example\/book/);
  });
});

describe("caption link policy", () => {
  const offerComment: LinkOffer = {
    url: "https://book.example/",
    mode: "comment_dm",
    keyword: "LINK",
    confirmed_at: new Date().toISOString(),
  };

  it("strips URLs from IG captions and adds CTA", () => {
    const out = applyLinkOfferToCaption(
      "Hello https://book.example/ visit us",
      offerComment,
      "instagram",
      "feed",
    );
    expect(out).not.toMatch(/https?:\/\//);
    expect(out.toLowerCase()).toContain("comment link");
  });

  it("allows URLs on Facebook caption_url mode", () => {
    const offer: LinkOffer = { ...offerComment, mode: "caption_url" };
    const out = applyLinkOfferToCaption("Come in this week", offer, "facebook", "feed");
    expect(out).toContain("https://book.example/");
  });

  it("platformForbidsCaptionUrl for IG feed/reel/story", () => {
    expect(platformForbidsCaptionUrl("instagram", "feed")).toBe(true);
    expect(platformForbidsCaptionUrl("instagram", "reel")).toBe(true);
    expect(platformForbidsCaptionUrl("instagram", "story")).toBe(true);
    expect(platformForbidsCaptionUrl("facebook", "feed")).toBe(false);
  });

  it("buildLinkOffer picks comment_dm for IG feed", () => {
    const offer = buildLinkOffer({
      url: "https://book.example/",
      platform: "instagram",
      format: "feed",
    });
    expect(offer.mode).toBe("comment_dm");
  });

  it("buildLinkOffer picks story_cta for IG story", () => {
    const offer = buildLinkOffer({
      url: "https://book.example/",
      platform: "instagram",
      format: "story",
    });
    expect(offer.mode).toBe("story_cta");
    expect(storyLinkCta(offer)).toMatch(/DM me|comment/i);
  });
});

describe("matchesLinkOfferRequest", () => {
  const offer: LinkOffer = {
    url: "https://book.example/",
    mode: "comment_dm",
    keyword: "LINK",
    confirmed_at: "",
  };

  it("matches keyword and soft intents", () => {
    expect(matchesLinkOfferRequest("LINK", offer)).toBe(true);
    expect(matchesLinkOfferRequest("send me the link please", offer)).toBe(true);
    expect(matchesLinkOfferRequest("nice photo!", offer)).toBe(false);
  });
});

describe("intent helpers", () => {
  it("detects destination link intents", () => {
    expect(looksLikeDestinationLinkIntent("put a link in this")).toBe(true);
    expect(looksLikeDestinationLinkIntent("create a post with our booking link")).toBe(true);
    expect(looksLikeDestinationLinkIntent("our booking link is https://calendly.com/lab-cafe")).toBe(true);
    expect(looksLikeDestinationLinkIntent("what's for lunch")).toBe(false);
  });

  it("extracts urls and yes confirm", () => {
    expect(extractUrlFromMessage("use https://x.example/y thanks")).toMatch(/x\.example\/y/);
    expect(looksLikeLinkConfirmYes("yes")).toBe(true);
    expect(looksLikeLinkConfirmYes("yep that works")).toBe(true);
  });

  it("asks to confirm an update as a booking link, not a post CTA", () => {
    expect(confirmationSms("https://calendly.com/lab-cafe", "update")).toMatch(/as your booking link/);
    expect(confirmationSms("https://calendly.com/lab-cafe", "update")).not.toMatch(/for this post/);
  });
});
