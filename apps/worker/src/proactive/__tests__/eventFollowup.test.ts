import { describe, it, expect, vi } from "vitest";
import type { Brand, KipEvent } from "@pulse/shared";
import { runEventFollowup, eventFollowupEnabled, type EventFollowupDeps } from "../eventFollowup.js";

const NOW = new Date("2026-09-18T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function passedEvent(partial: Partial<KipEvent> = {}): KipEvent {
  return {
    id: partial.id ?? "e1",
    summary: partial.summary ?? "photoshoot for Emily Calder",
    entity: partial.entity ?? "Emily Calder",
    kind: "shoot",
    when_iso: partial.when_iso ?? new Date(NOW.getTime() - 2 * DAY).toISOString(),
    when_text: partial.when_text ?? "the other day",
    created_at: "2026-09-10T00:00:00.000Z",
    followed_up_at: partial.followed_up_at ?? null,
    status: partial.status ?? "upcoming",
  };
}

function brandWith(events: KipEvent[], id = "brand-1"): Brand {
  return { id, facts: { kip_events: events } } as unknown as Brand;
}

function makeDeps(over: Partial<EventFollowupDeps> & { brands: Brand[] }): {
  deps: EventFollowupDeps;
  sent: Array<{ brandId: string; body: string }>;
  marked: string[];
  recorded: string[];
  closed: Array<{ brandId: string; ids: string[] }>;
} {
  const sent: Array<{ brandId: string; body: string }> = [];
  const marked: string[] = [];
  const recorded: string[] = [];
  const closed: Array<{ brandId: string; ids: string[] }> = [];
  const deps: EventFollowupDeps = {
    listBrandsWithEvents: async () => over.brands,
    isDaytime: over.isDaytime ?? (() => true),
    canSendProactive: over.canSendProactive ?? (async () => true),
    recordProactiveSend: async (brandId) => {
      recorded.push(brandId);
    },
    compose: over.compose ?? (async (_b, e) => `how'd ${e.summary} go?`),
    sendToBrand: async (brandId, body) => {
      sent.push({ brandId, body });
    },
    markFollowedUp: async (brandId, eventId) => {
      marked.push(`${brandId}:${eventId}`);
    },
    closeStale: async (brandId, ids) => {
      closed.push({ brandId, ids });
    },
    now: () => NOW,
  };
  return { deps, sent, marked, recorded, closed };
}

describe("eventFollowupEnabled", () => {
  it("is off unless the flag is exactly 'on'", () => {
    expect(eventFollowupEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(eventFollowupEnabled({ KIP_EVENT_FOLLOWUP: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(eventFollowupEnabled({ KIP_EVENT_FOLLOWUP: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("runEventFollowup", () => {
  it("sends one follow-up, then marks and records it", async () => {
    const { deps, sent, marked, recorded } = makeDeps({ brands: [brandWith([passedEvent()])] });
    await runEventFollowup(deps);
    expect(sent).toEqual([{ brandId: "brand-1", body: "how'd photoshoot for Emily Calder go?" }]);
    expect(marked).toEqual(["brand-1:e1"]);
    expect(recorded).toEqual(["brand-1"]);
  });

  it("marks BEFORE it sends, so a crash mid-send can't double-ask", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({ brands: [brandWith([passedEvent()])] });
    deps.markFollowedUp = async () => {
      order.push("mark");
    };
    deps.sendToBrand = async () => {
      order.push("send");
    };
    await runEventFollowup(deps);
    expect(order).toEqual(["mark", "send"]);
  });

  it("does not send for a future event but leaves it untouched", async () => {
    const future = passedEvent({ id: "f", when_iso: new Date(NOW.getTime() + DAY).toISOString() });
    const { deps, sent, marked } = makeDeps({ brands: [brandWith([future])] });
    await runEventFollowup(deps);
    expect(sent).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  it("skips sending outside daytime and does not mark (retries later)", async () => {
    const { deps, sent, marked } = makeDeps({ brands: [brandWith([passedEvent()])], isDaytime: () => false });
    await runEventFollowup(deps);
    expect(sent).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  it("still retires stale events even at night", async () => {
    const stale = passedEvent({ id: "s", when_iso: new Date(NOW.getTime() - 30 * DAY).toISOString() });
    const { deps, sent, closed } = makeDeps({ brands: [brandWith([stale])], isDaytime: () => false });
    await runEventFollowup(deps);
    expect(sent).toHaveLength(0);
    expect(closed).toEqual([{ brandId: "brand-1", ids: ["s"] }]);
  });

  it("respects the proactive budget", async () => {
    const { deps, sent } = makeDeps({ brands: [brandWith([passedEvent()])], canSendProactive: async () => false });
    await runEventFollowup(deps);
    expect(sent).toHaveLength(0);
  });

  it("is idempotent across ticks — a followed event isn't asked again", async () => {
    const brand = brandWith([passedEvent()]);
    const { deps, sent } = makeDeps({ brands: [brand] });
    // Simulate the mark persisting between ticks by flipping the event's flag.
    deps.markFollowedUp = async (_brandId, eventId) => {
      const stored = (brand.facts.kip_events as KipEvent[]).find((e) => e.id === eventId);
      if (stored) stored.followed_up_at = NOW.toISOString();
    };
    await runEventFollowup(deps);
    await runEventFollowup(deps);
    expect(sent).toHaveLength(1);
  });

  it("one brand's failure doesn't stop the next", async () => {
    const { deps, sent } = makeDeps({ brands: [brandWith([passedEvent()], "b1"), brandWith([passedEvent({ id: "e2" })], "b2")] });
    let first = true;
    deps.sendToBrand = async (brandId, body) => {
      if (first) {
        first = false;
        throw new Error("twilio hiccup");
      }
      sent.push({ brandId, body });
    };
    await runEventFollowup(deps);
    expect(sent).toEqual([{ brandId: "b2", body: "how'd photoshoot for Emily Calder go?" }]);
  });
});
