import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SEND_DRAFT_RE,
  CANCEL_RE,
  HOLD_RE,
  looksLikeMetaDisconnect,
  looksLikeMetaDisconnectConfirm,
  looksLikeConnectStatus,
  userAskedForContentWork,
  SCRATCH_OR_TWEAK_ASK_RE,
  looksLikeCarouselCommand,
} from "../processInbound.js";
import { looksLikeBoostRequest } from "../boost.js";
import { looksLikeCalendarAsk } from "../agentTools.js";
import { looksLikeGreeting } from "../classify.js";
import {
  looksLikePhotoBackgroundAsk,
  photoBackgroundAskCoversBatch,
} from "../visualMode.js";
import { looksLikeCampaignControl } from "../campaigns.js";
import { looksLikeAdCampaignControl } from "../adCampaigns.js";

/**
 * Table-driven coverage for the inbound router's intent matchers.
 *
 * Every "must not" string below is a real phrasing that was confirmed to route
 * somewhere destructive: publishing a public comment as the client, wiping the
 * Meta connection, rejecting a whole batch of drafts, hijacking an organic ask
 * into paid ads, holding an unrelated post, or silently cancelling a proposal.
 * The total absence of matcher coverage is why they shipped.
 */
function table(
  name: string,
  match: (s: string) => boolean,
  cases: { must: string[]; mustNot: string[] },
) {
  describe(name, () => {
    it.each(cases.must)("matches %j", (s) => {
      expect(match(s)).toBe(true);
    });
    it.each(cases.mustNot)("does NOT match %j", (s) => {
      expect(match(s)).toBe(false);
    });
  });
}

// Finding 1 — publishes a public reply on the client's real IG/FB post.
table("SEND_DRAFT_RE", (s) => SEND_DRAFT_RE.test(s), {
  must: [
    "send",
    "Send",
    "send it",
    "send that",
    "post it",
    "approve it",
    "approve that",
    "approve that reply",
    "approve the reply",
    "send it.",
    "  send  ",
  ],
  mustNot: [
    "send me some post ideas",
    "send me 3 post ideas for next week",
    "send over the schedule",
    "send that link again",
    "send the invoice to my accountant",
    "post it tomorrow instead",
    "send this instead: hi there",
    "approve the budget",
  ],
});

// Finding 2 — wiping the Meta tokens needs a full OAuth re-auth to undo.
table("meta disconnect intent", looksLikeMetaDisconnect, {
  must: [
    "disconnect instagram",
    "disconnect my accounts",
    "unlink facebook",
    "please disconnect meta",
    "disconnect fb",
  ],
  mustNot: [
    "remove the fb post",
    "remove my account",
    "remove that caption",
    "disconnect the fb post",
    "unlink the photo from that instagram post",
    "remove the tag on that instagram story",
    "connect instagram",
  ],
});

describe("meta disconnect confirmation", () => {
  it("requires an explicit word, never a bare yes", () => {
    expect(looksLikeMetaDisconnectConfirm("disconnect")).toBe(true);
    expect(looksLikeMetaDisconnectConfirm("yes, disconnect")).toBe(true);
    expect(looksLikeMetaDisconnectConfirm("disconnect them")).toBe(true);
    expect(looksLikeMetaDisconnectConfirm("yes")).toBe(false);
    expect(looksLikeMetaDisconnectConfirm("ok")).toBe(false);
    expect(looksLikeMetaDisconnectConfirm("disconnect the fb post")).toBe(false);
  });
});

// Finding 4 — a tweak to one photo used to reject EVERY pending draft.
table("looksLikePhotoBackgroundAsk", looksLikePhotoBackgroundAsk, {
  must: [
    "Could you put pictures in the background of them? All of them",
    "put pictures in the background",
    "add photo backgrounds",
    "can you add photos behind the text",
    "use stock photos for the background",
  ],
  mustNot: [
    "can you blur the background of that photo",
    "the background photo is too dark",
    "crop the background out of this pic",
    "make it brighter",
    "make the background brighter",
    "use text cards with a plain background",
  ],
});

table("photoBackgroundAskCoversBatch", photoBackgroundAskCoversBatch, {
  must: [
    "Could you put pictures in the background of them? All of them",
    "put photos behind all of these",
    "photo backgrounds on them please",
    "add photo backgrounds to every one",
  ],
  mustNot: [
    "put a picture in the background of this one",
    "add a photo background here",
    "can you add photos behind the text",
  ],
});

// Finding 5 — organic "promote"/"boost" was hijacked into the paid-ads handoff.
table("looksLikeBoostRequest", looksLikeBoostRequest, {
  must: [
    "boost this",
    "boost it",
    "promote that post",
    "promote this",
    "boost the winning post",
    "boost my latest post",
    "put money behind this",
    "turn this into an ad",
    "campaign this",
  ],
  mustNot: [
    "can you promote our new winter menu this week",
    "promote the new menu",
    "boost our winter menu",
    "we're promoting the sale all week",
    "how did we do",
  ],
});

// Finding 6 — HOLD_RE ate campaign and ads verbs.
table("HOLD_RE", (s) => HOLD_RE.test(s), {
  must: [
    "hold",
    "HOLD",
    "hold on",
    "hold it",
    "stop",
    "stop it",
    "wait",
    "pause",
    "pause it",
    "cancel that",
    "don't post it",
    "dont post",
  ],
  mustNot: [
    "pause the campaign",
    "cancel the campaign",
    "stop the ads",
    "hold on, what was that price again?",
    "wait, can you make it shorter",
    "pause the ads for now",
    "stop sending me stuff on weekends",
  ],
});

describe("HOLD_RE branch guards", () => {
  // The branch also stands down for campaign/ads control and any question.
  const campaignish = ["pause the campaign", "cancel the campaign", "stop the ads"];
  it.each(campaignish)("%j reaches its own handler", (s) => {
    const isHold =
      HOLD_RE.test(s) &&
      !s.includes("?") &&
      !looksLikeCampaignControl(s) &&
      !looksLikeAdCampaignControl(s);
    expect(isHold).toBe(false);
  });
});

// Finding 7 — Kip queued drafts off its own small talk.
table("userAskedForContentWork", userAskedForContentWork, {
  must: [
    "can you draft me a couple of posts",
    "make me a carousel",
    "write me 3 posts for next week",
    "I don't have any photos to send",
    "no photos this week, use stock",
    "got any post ideas?",
  ],
  mustNot: [
    "how often should I post?",
    "should I post on weekends?",
    "what's my booking link",
    "thanks, that's great",
    "how's it going",
  ],
});

// Finding 8 — "no worries, thanks" cancelled proposals.
table("CANCEL_RE", (s) => CANCEL_RE.test(s), {
  must: [
    "no",
    "No.",
    "nope",
    "nah",
    "cancel",
    "cancel that",
    "scrap it",
    "scrap that",
    "forget it",
    "don't",
    "dont do it",
    "no thanks",
    "not now",
  ],
  mustNot: [
    "no worries, thanks",
    "no photos this week, use stock",
    "nope all good",
    "no idea, what do you reckon",
    "cancel the campaign",
    "don't post that on Friday, do Saturday",
  ],
});

// Finding 10 — an LLM "media" with nothing attached inserted a post with empty
// media_ids that could never publish.
describe("classifyInbound media coercion", () => {
  it("coerces media to other when no media arrived", async () => {
    vi.resetModules();
    vi.doMock("../llm.js", () => ({
      callLLM: vi.fn(async () => JSON.stringify({ classification: "media", confidence: 0.9 })),
      stripMarkdown: (s: string) => s,
    }));
    const { classifyInbound } = await import("../classify.js");
    const res = await classifyInbound({
      body: "that shot of the bar from last week",
      hasMedia: false,
      hasPendingPost: false,
    });
    expect(res.classification).toBe("other");
    vi.doUnmock("../llm.js");
    vi.resetModules();
  });
});

/**
 * SQL contracts. No test drives processInbound end-to-end, so these pin the two
 * statements whose shape IS the fix — cheap insurance against a silent revert.
 */
describe("processInbound SQL contracts", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"),
    "utf8",
  );

  it("resolves the pending draft by delivery order, not creation order (finding 9)", () => {
    expect(src).toMatch(/order by coalesce\(last_offered_at, created_at\) desc/);
    expect(src).toMatch(/update posts set last_offered_at = now\(\)/);
  });

  it("scopes the photo-background rejection to specific ids (finding 4)", () => {
    expect(src).toMatch(/status = 'rejected'[\s\S]{0,160}id = any\(\$2::uuid\[\]\)/);
    // The unscoped "every pending row" rejection must be gone.
    expect(src).not.toMatch(
      /update posts set status = 'rejected', updated_at = now\(\)\s*\n\s*where brand_id = \$1 and status = 'pending_approval'`/,
    );
  });

  it("never wipes Meta tokens without a staged confirmation (finding 2)", () => {
    const wipeIndex = src.indexOf("platform_tokens_encrypted = null");
    expect(wipeIndex).toBeGreaterThan(-1);
    const guard = src.slice(Math.max(0, wipeIndex - 700), wipeIndex);
    expect(guard).toMatch(/looksLikeMetaDisconnectConfirm/);
  });

  it("discards a pending draft on a bare no before the classifier can approve it", () => {
    expect(src).toMatch(/pending && message\.body && newMedia\.length === 0 && CANCEL_RE\.test\(message\.body\)/);
    expect(src).toMatch(/Owner discarded the pending draft/);
  });

  it("stores our-booking-link-is and competitor intel even with a pending draft", () => {
    expect(src).toMatch(/!pending \|\| storeOnFile/);
    expect(src).toMatch(/booking\\s\+link\\s\+is/);
    expect(src).not.toMatch(/!pending && looksLikeDestinationLinkIntent/);
    expect(src).not.toMatch(/!pending && COMPETITOR_RE/);
  });

  it("asks for a clip on a bare make-a-reel instead of animating banked stills", () => {
    const idx = src.indexOf('looksLikeMakeReelRequest(message.body) && newMedia.length === 0');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 500);
    expect(slice).toMatch(/Send me the video clip/);
    expect(slice).not.toMatch(/pickFreshPhotos/);
  });
});

// Finding 10 — "tweak it" must not trigger a full plan rebuild unprompted.
table("SCRATCH_OR_TWEAK_ASK_RE (Kip's last reply)", (s) => SCRATCH_OR_TWEAK_ASK_RE.test(s), {
  must: [
    "Want me to rebuild the plan from scratch, or just tweak what's there?",
    "Should I tweak the current one or start over from scratch?",
    "Happy to start again from the ground up, or we can just adjust a couple of pillars.",
  ],
  mustNot: [
    "Tell me what to change and I'll tweak it.",
    "Here's your post. Reply yes to approve, or tell me a tweak.",
    "I'll keep your posts spread across the week.",
  ],
});

table("looksLikeCalendarAsk", looksLikeCalendarAsk, {
  must: [
    "what's on my calendar this week?",
    "Whats on my calendar",
    "check my calendar",
    "show me the schedule",
    "this week's posts",
    "what's coming up this week",
  ],
  mustNot: [
    "make me a carousel this week",
    "draft me 3 posts",
    "can you promote our new winter menu this week",
    "what's on my calendar and make a carousel",
    "schedule this for Thursday",
    "hey",
  ],
});

table("looksLikeGreeting", looksLikeGreeting, {
  must: ["hi", "Hey!", "hello", "thanks", "thanks so much", "how's it going", "morning"],
  mustNot: ["hey can you post this", "thanks for the carousel", "draft me 3 posts", "yes"],
});

table("looksLikeConnectStatus", looksLikeConnectStatus, {
  must: [
    "what platforms am I posting to?",
    "which platforms am I posting to",
    "where am I posting",
    "am I connected",
    "what's connected",
    "connection status",
    "is instagram connected",
  ],
  mustNot: [
    "connect instagram",
    "draft me 3 posts",
    "what platforms should I try next year",
    "boost this",
  ],
});

table("looksLikeCarouselCommand", looksLikeCarouselCommand, {
  must: [
    "make it a carousel",
    "turn these into a carousel",
    "bundle these into a carousel",
    "bundle these into a carousel, cinematic, text over the top",
    "as a carousel",
    "carousel",
  ],
  mustNot: [
    "carousel ideas for next week",
    "what's a carousel",
    "make a reel",
    "put this on my story",
  ],
});
