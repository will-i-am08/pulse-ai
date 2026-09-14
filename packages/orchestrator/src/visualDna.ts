/**
 * Unified visual DNA — one prompt block + overlay cue for T2I / LLM / burn-in.
 * Composes brand tokens, photo style bits, library reference, faceless lines,
 * and design-memory context from the composer.
 */

import type { Brand } from "@pulse/shared";
import { gatherDesignContext, type DesignContext } from "./designComposer.js";
import {
  facelessPhotoConstraint,
  facelessPromptLine,
  isFacelessBrand,
} from "./faceless.js";
import { brandPhotoStyleBits } from "./imaging.js";
import { visualReference } from "./library.js";

export type VisualDna = {
  /** Single string to append to T2I / LLM system prompts. */
  promptBlock: string;
  /** Short palette/font cue for overlays. */
  overlayHints: string;
  coldStart: boolean;
  faceless: boolean;
  designContext: DesignContext;
};

const PROMPT_BLOCK_MAX = 800;

function trimBlock(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function memoryNoteSnippets(ctx: DesignContext, limit = 4): string[] {
  const notes: string[] = [];
  for (const ref of [...ctx.topMemory, ...ctx.ownMemory]) {
    const n = (ref.notes ?? "").trim();
    if (!n) continue;
    notes.push(n);
    if (notes.length >= limit) break;
  }
  return notes;
}

function buildOverlayHints(brand: Brand): string {
  const v = brand.visual ?? {};
  return [
    v.colors?.length ? `palette ${v.colors.slice(0, 4).join(", ")}` : "",
    v.fonts?.length ? `fonts ${v.fonts.slice(0, 2).join(", ")}` : "",
    v.aesthetic ? `look ${v.aesthetic}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildPromptBlock(brand: Brand, designContext: DesignContext): string {
  const v = brand.visual ?? {};
  const styleBits = brandPhotoStyleBits(brand);
  const ref = visualReference(brand);
  const faceLine = facelessPromptLine(brand);
  const facePhoto = facelessPhotoConstraint(brand);
  const memory = memoryNoteSnippets(designContext);

  // Identity + constraints first so truncation keeps memory / faceless cues.
  const priority: string[] = [
    v.aesthetic ? `Aesthetic: ${v.aesthetic}.` : "",
    v.aesthetic_notes ? String(v.aesthetic_notes).trim() : "",
    v.colors?.length ? `Colours: ${v.colors.join(", ")}.` : "",
    v.photo_treatment ? `Photo treatment: ${v.photo_treatment}.` : "",
    faceLine ?? "",
    facePhoto,
    ...memory.map((n) => `Memory: ${n}`),
    designContext.bootstrapNotes,
  ];

  // Style / library cues next — may be trimmed by the 800-char budget.
  const styleExtra = styleBits.filter((b) => {
    const lower = b.toLowerCase();
    if (v.aesthetic && lower === v.aesthetic.toLowerCase()) return false;
    if (v.photo_treatment && lower === v.photo_treatment.toLowerCase()) return false;
    if (v.aesthetic_notes && lower === v.aesthetic_notes.toLowerCase()) return false;
    return true;
  });
  const secondary: string[] = [
    styleExtra.length ? `Photo style: ${styleExtra.join("; ")}.` : "",
    ref,
  ];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const b of [...priority, ...secondary]) {
    const t = (b ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }

  return trimBlock(unique.join(" "), PROMPT_BLOCK_MAX);
}

/** Gather brand visual DNA for prompts and overlay composition. */
export async function gatherVisualDna(brand: Brand): Promise<VisualDna> {
  const designContext = await gatherDesignContext(brand);
  return {
    promptBlock: buildPromptBlock(brand, designContext),
    overlayHints: buildOverlayHints(brand),
    coldStart: designContext.coldStart,
    faceless: isFacelessBrand(brand),
    designContext,
  };
}

/** Compact one-liner for photo / T2I prompts. */
export function visualDnaPromptLine(dna: VisualDna): string {
  const block = (dna.promptBlock ?? "").replace(/\s+/g, " ").trim();
  if (!block) return "";
  const core = trimBlock(block, 240);
  return `Brand visual DNA: ${core}`;
}
