import { describe, expect, it } from "vitest";
import {
  sampleStyleBank,
  styleBankPromptBlock,
  STYLE_BANK,
} from "../speak/styleBank.js";
import {
  STRUCTURAL_CONSTRAINTS,
  pickStructuralConstraint,
  structuralConstraintPromptBlock,
} from "../speak/constraints.js";
import {
  jaccardSimilarity,
  tooSimilarToRecent,
  SIMILARITY_THRESHOLD,
} from "../speak/similarity.js";
import { humanizeChat } from "../speak/humanizeChat.js";
import { needsThink } from "../speak/think.js";
import {
  EMPTY_OPEN_LOOPS,
  openLoopsPromptBlock,
  readOpenLoops,
} from "../speak/openLoops.js";
import { recentOutsPromptBlock } from "../speak/recentOuts.js";
import { buildSpeakSystem } from "../speak/index.js";
import type { Brand } from "@pulse/shared";

function stubBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "b1",
    name: "Test Cafe",
    facts: {},
    ...over,
  } as Brand;
}

describe("styleBank", () => {
  it("has a deep enough bank for variety", () => {
    expect(STYLE_BANK.length).toBeGreaterThanOrEqual(20);
  });

  it("samples without duplicates and injects into the prompt", () => {
    const samples = sampleStyleBank("converse", 4);
    expect(samples).toHaveLength(4);
    expect(new Set(samples.map((s) => s.text)).size).toBe(4);
    const block = styleBankPromptBlock("nudge", 3);
    expect(block).toMatch(/Sound like these example texts/i);
    expect(block.split("\n").length).toBeGreaterThan(3);
  });
});

describe("structural constraints", () => {
  it("rotates deterministically when seeded", () => {
    expect(pickStructuralConstraint(0)).toBe(STRUCTURAL_CONSTRAINTS[0]);
    expect(pickStructuralConstraint(STRUCTURAL_CONSTRAINTS.length)).toBe(STRUCTURAL_CONSTRAINTS[0]);
    expect(structuralConstraintPromptBlock(2)).toContain(STRUCTURAL_CONSTRAINTS[2]!);
  });
});

describe("similarity gate", () => {
  it("flags near-duplicate outs", () => {
    const a = "Hey, we're a bit light on tips this week. Got a photo?";
    const b = "Hey, we're a bit light on tips this week. Got a photo I could use?";
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(SIMILARITY_THRESHOLD);
    expect(tooSimilarToRecent(b, [a])).toBe(true);
  });

  it("allows genuinely different wording", () => {
    const recent = ["Hey, we're a bit light on tips this week. Got a photo?"];
    const fresh = "Could use a proof post soon — want me to draft from stock?";
    // humanize would strip the em dash; raw similarity should still be low
    expect(tooSimilarToRecent(fresh.replace("—", ","), recent)).toBe(false);
  });
});

describe("humanizeChat", () => {
  it("strips chat AI tells and em dashes", () => {
    const out = humanizeChat("I hope this message finds you well — I'd be happy to help.");
    expect(out.toLowerCase()).not.toMatch(/hope this message finds you well/);
    expect(out).not.toMatch(/—/);
  });
});

describe("needsThink", () => {
  it("skips think on short greetings and nudges", () => {
    expect(needsThink({ mode: "converse", message: "hey" })).toBe(false);
    expect(needsThink({ mode: "nudge", message: "anything" })).toBe(false);
  });

  it("thinks on hard turns", () => {
    expect(needsThink({ mode: "reengage", message: "hi again" })).toBe(true);
    expect(
      needsThink({
        mode: "answer",
        message: "I'm frustrated — that caption is totally wrong, change it",
      }),
    ).toBe(true);
    expect(
      needsThink({
        mode: "converse",
        message: "Let's rethink our positioning versus the main competitor",
      }),
    ).toBe(true);
    expect(
      needsThink({ mode: "answer", message: "what?", classification: "question", confidence: 0.4 }),
    ).toBe(true);
  });
});

describe("open loops", () => {
  it("reads empty loops safely", () => {
    expect(readOpenLoops(stubBrand())).toEqual(EMPTY_OPEN_LOOPS);
    expect(openLoopsPromptBlock(EMPTY_OPEN_LOOPS)).toBe("");
  });

  it("formats a non-empty scratchpad", () => {
    const block = openLoopsPromptBlock({
      waiting_on: ["logo"],
      promised: ["draft carousel"],
      prefs: ["short captions"],
      energy: "careful",
    });
    expect(block).toMatch(/Waiting on owner: logo/);
    expect(block).toMatch(/You promised: draft carousel/);
    expect(block).toMatch(/Prefs: short captions/);
  });
});

describe("recent outs + buildSpeakSystem", () => {
  it("injects negative examples and style bank into the system prompt", () => {
    const recentBlock = recentOutsPromptBlock([
      "Hey, we're a bit light on tips this week. Got a photo?",
      "Running short on proof posts — send a snap?",
    ]);
    expect(recentBlock).toMatch(/do NOT reuse/i);

    const system = buildSpeakSystem({
      brand: stubBrand({
        facts: { owner_name: "Bill", open_loops: { waiting_on: ["menu PDF"], energy: "steady" } },
      }),
      mode: "converse",
      modeLines: ["Reply warmly."],
      recentOutbound: ["Hey Bill — around if you want to post."],
      constraintSeed: 1,
    });
    expect(system).toMatch(/Sound like these example texts/i);
    expect(system).toMatch(/do NOT reuse/i);
    expect(system).toMatch(/Structural constraint/i);
    expect(system).toMatch(/Waiting on owner: menu PDF/);
    expect(system).toMatch(/Reply warmly/);
    expect(system).toMatch(/Plain SMS only/i);
  });
});
