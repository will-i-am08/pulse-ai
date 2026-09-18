import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NEVER_INVENT_PROOF, personaVoiceLines } from "../persona.js";
import type { Brand } from "@pulse/shared";

function stubBrand(): Brand {
  return { id: "b1", name: "Sparky Co", facts: {} } as Brand;
}

describe("NEVER_INVENT_PROOF", () => {
  it("bans invented jobs when the proof bank is empty", () => {
    expect(NEVER_INVENT_PROOF).toMatch(/this-week incidents/i);
    expect(NEVER_INVENT_PROOF).toMatch(/made-up job/i);
    expect(personaVoiceLines(stubBrand()).join("\n")).toContain(NEVER_INVENT_PROOF);
  });

  it("bans invented sourcing and quality claims unless already in facts or brief", () => {
    expect(NEVER_INVENT_PROOF).toMatch(/sourcing/i);
    expect(NEVER_INVENT_PROOF).toMatch(/finest/i);
    expect(NEVER_INVENT_PROOF).toMatch(/sashimi-grade/i);
    expect(NEVER_INVENT_PROOF).toMatch(/hand-selected/i);
    expect(NEVER_INVENT_PROOF).toMatch(/award-winning/i);
    expect(NEVER_INVENT_PROOF).toMatch(/#1/);
    expect(NEVER_INVENT_PROOF).toMatch(/since 19xx/i);
    expect(NEVER_INVENT_PROOF).toMatch(/facts or the owner brief/i);
  });

  it("is wired into filler, caption, and format prompts", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    const caption = readFileSync(join(here, "../draftCaption.ts"), "utf8");
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const formats = readFileSync(join(here, "../formats.ts"), "utf8");
    expect(fillers).toMatch(/NEVER_INVENT_PROOF/);
    expect(fillers).toMatch(/fault found today/);
    expect(caption).toMatch(/NEVER_INVENT_PROOF/);
    expect(imaging).toMatch(/not a fake incident/);
    expect(formats).toMatch(/NEVER_INVENT_PROOF/);
  });

  it("is in photo carousel AND typed carousel AND story overlay prompt paths", () => {
    const formats = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../formats.ts"),
      "utf8",
    );
    expect(formats).toMatch(/import \{ NEVER_INVENT_PROOF \} from "\.\/persona\.js"/);
    const photo = formats.slice(
      formats.indexOf("export async function generatePhotoTextCarousel"),
      formats.indexOf("export async function generateTipCarousel"),
    );
    const typed = formats.slice(
      formats.indexOf("export async function generateTypedCarousel"),
      formats.indexOf("export async function generatePhotoTextCarousel"),
    );
    const story = formats.slice(
      formats.indexOf("export async function draftStoryOverlay"),
      formats.indexOf("async function renderTypedSlides"),
    );
    expect(photo, "photo carousel prompt").toMatch(/NEVER_INVENT_PROOF/);
    expect(typed, "typed carousel prompt").toMatch(/NEVER_INVENT_PROOF/);
    expect(story, "story overlay prompt").toMatch(/NEVER_INVENT_PROOF/);
    // import + three prompt paths — not a single unused import
    expect(formats.match(/NEVER_INVENT_PROOF/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
