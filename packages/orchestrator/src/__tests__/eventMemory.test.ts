import { describe, it, expect } from "vitest";
import type { BusinessFacts, KipEvent } from "@pulse/shared";
import {
  looksLikeEvent,
  parseEventsResponse,
  eventsPromptBlock,
  selectDueEvent,
  FOLLOWUP_GRACE_MS,
  STALE_MS,
} from "../eventMemory.js";

const NOW = new Date("2026-09-18T09:00:00.000Z");

function evt(partial: Partial<KipEvent>): KipEvent {
  return {
    id: partial.id ?? "e1",
    summary: partial.summary ?? "photoshoot for Emily Calder",
    entity: partial.entity ?? "Emily Calder",
    kind: partial.kind ?? "shoot",
    when_iso: partial.when_iso ?? null,
    when_text: partial.when_text ?? "",
    created_at: partial.created_at ?? "2026-09-10T00:00:00.000Z",
    followed_up_at: partial.followed_up_at ?? null,
    status: partial.status ?? "upcoming",
  };
}

describe("looksLikeEvent", () => {
  it("fires on time cues and life-event nouns", () => {
    expect(looksLikeEvent("shooting Emily Calder on Friday")).toBe(true);
    expect(looksLikeEvent("big launch next week")).toBe(true);
    expect(looksLikeEvent("I'm travelling tomorrow")).toBe(true);
  });
  it("stays quiet on plain chatter", () => {
    expect(looksLikeEvent("make the caption punchier")).toBe(false);
    expect(looksLikeEvent("thanks!")).toBe(false);
    expect(looksLikeEvent("")).toBe(false);
    expect(looksLikeEvent(null)).toBe(false);
  });
});

describe("parseEventsResponse", () => {
  it("parses a well-formed event and stamps id/created_at", () => {
    const raw = JSON.stringify({
      events: [
        { summary: "photoshoot for Emily Calder", entity: "Emily Calder", kind: "shoot", when_iso: "2026-09-19T02:00:00.000Z", when_text: "Friday" },
      ],
    });
    const out = parseEventsResponse(raw, NOW.toISOString());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      summary: "photoshoot for Emily Calder",
      entity: "Emily Calder",
      kind: "shoot",
      when_iso: "2026-09-19T02:00:00.000Z",
      status: "upcoming",
      followed_up_at: null,
      created_at: NOW.toISOString(),
    });
    expect(out[0].id).toBeTruthy();
  });

  it("tolerates markdown fencing and prose around the JSON", () => {
    const raw = "Sure!\n```json\n{\"events\":[{\"summary\":\"store opening\",\"kind\":\"launch\"}]}\n```";
    const out = parseEventsResponse(raw, NOW.toISOString());
    expect(out).toHaveLength(1);
    expect(out[0].when_iso).toBeNull();
  });

  it("returns [] on empty, junk, or missing summary", () => {
    expect(parseEventsResponse("{\"events\":[]}", NOW.toISOString())).toEqual([]);
    expect(parseEventsResponse("not json", NOW.toISOString())).toEqual([]);
    expect(parseEventsResponse(JSON.stringify({ events: [{ entity: "x" }] }), NOW.toISOString())).toEqual([]);
  });

  it("drops an unknown kind to the schema default rather than throwing", () => {
    const raw = JSON.stringify({ events: [{ summary: "thing", kind: "wormhole" }] });
    const out = parseEventsResponse(raw, NOW.toISOString());
    expect(out).toEqual([]); // enum parse fails → dropped, never throws
  });
});

describe("eventsPromptBlock", () => {
  it("is empty when there are no events", () => {
    expect(eventsPromptBlock(null, NOW)).toBe("");
    expect(eventsPromptBlock({ kip_events: [] } as BusinessFacts, NOW)).toBe("");
  });

  it("surfaces an un-followed passed event as a 'how it went' cue", () => {
    const facts = { kip_events: [evt({ when_iso: "2026-09-17T00:00:00.000Z", when_text: "yesterday" })] } as BusinessFacts;
    const block = eventsPromptBlock(facts, NOW);
    expect(block).toContain("Just happened");
    expect(block).toContain("how it went");
    expect(block).toContain("Emily Calder");
  });

  it("lists an upcoming event but not a closed or already-followed one", () => {
    const facts = {
      kip_events: [
        evt({ id: "a", summary: "market stall", when_iso: "2026-09-25T00:00:00.000Z", when_text: "next Friday" }),
        evt({ id: "b", summary: "old shoot", when_iso: "2026-09-01T00:00:00.000Z", status: "closed" }),
        evt({ id: "c", summary: "done shoot", when_iso: "2026-09-02T00:00:00.000Z", followed_up_at: NOW.toISOString() }),
      ],
    } as BusinessFacts;
    const block = eventsPromptBlock(facts, NOW);
    expect(block).toContain("Coming up");
    expect(block).toContain("market stall");
    expect(block).not.toContain("old shoot");
    expect(block).not.toContain("done shoot");
  });
});

describe("selectDueEvent", () => {
  it("returns a passed, un-followed, dated event past the grace window", () => {
    const passed = evt({ id: "p", when_iso: new Date(NOW.getTime() - FOLLOWUP_GRACE_MS - 1000).toISOString() });
    const { due } = selectDueEvent([passed], NOW);
    expect(due?.id).toBe("p");
  });

  it("ignores events still within the grace window or in the future", () => {
    const fresh = evt({ id: "f", when_iso: new Date(NOW.getTime() - 1000).toISOString() });
    const future = evt({ id: "u", when_iso: new Date(NOW.getTime() + 86_400_000).toISOString() });
    expect(selectDueEvent([fresh, future], NOW).due).toBeNull();
  });

  it("ignores dateless events (can't know they passed)", () => {
    expect(selectDueEvent([evt({ id: "n", when_iso: null })], NOW).due).toBeNull();
  });

  it("skips already-followed and closed events", () => {
    const followed = evt({ id: "d", when_iso: "2026-09-10T00:00:00.000Z", followed_up_at: NOW.toISOString() });
    const closed = evt({ id: "c", when_iso: "2026-09-10T00:00:00.000Z", status: "closed" });
    expect(selectDueEvent([followed, closed], NOW).due).toBeNull();
  });

  it("retires stale events (passed > 14 days) instead of asking", () => {
    const stale = evt({ id: "s", when_iso: new Date(NOW.getTime() - STALE_MS - 86_400_000).toISOString() });
    const { due, toClose } = selectDueEvent([stale], NOW);
    expect(due).toBeNull();
    expect(toClose.map((e) => e.id)).toEqual(["s"]);
  });

  it("picks the soonest-passed when several are due", () => {
    const older = evt({ id: "old", when_iso: new Date(NOW.getTime() - 5 * 86_400_000).toISOString() });
    const recent = evt({ id: "recent", when_iso: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() });
    expect(selectDueEvent([older, recent], NOW).due?.id).toBe("recent");
  });
});
