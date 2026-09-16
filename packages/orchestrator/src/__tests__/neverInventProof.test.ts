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

  it("is wired into filler and caption prompts", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    const caption = readFileSync(join(here, "../draftCaption.ts"), "utf8");
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    expect(fillers).toMatch(/NEVER_INVENT_PROOF/);
    expect(fillers).toMatch(/fault found today/);
    expect(caption).toMatch(/NEVER_INVENT_PROOF/);
    expect(imaging).toMatch(/not a fake incident/);
  });
});
