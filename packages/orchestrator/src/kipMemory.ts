/**
 * Smart Kip Phase 3 — durable preferences / decisions on brand.facts.
 * Stored by remember_fact (tool loop) and optionally correction learning;
 * surfaced into Speak / persona / captions via kipMemoryPromptBlock.
 */

import { query, type Brand, type BusinessFacts } from "@pulse/shared";

export type KipMemoryBucket = "kip_preferences" | "kip_decisions";

export type KipMemoryEntry = { text: string; atISO: string };

const MAX_MEMORY_ENTRIES = 20;
const MAX_MEMORY_TEXT = 200;
const PROMPT_MAX_EACH = 6;
const PROMPT_TEXT_MAX = 160;

export function clampMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_TEXT);
}

/**
 * Split a compound "for the record" blob into atomic prefs so bans and
 * format rules don't get lost when the model summarises brand knowledge.
 * Single short prefs stay one entry.
 */
export function splitMemoryAtoms(text: string): string[] {
  const cleaned = clampMemoryText(text);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!;])\s+|(?<=\S)\s*;\s+(?=\S)/)
    .map((p) => p.replace(/^[,.\s]+|[,.\s]+$/g, "").trim())
    .filter((p) => p.length >= 8)
    .map((p) => clampMemoryText(p))
    .filter(Boolean);
  if (parts.length <= 1) return [cleaned];
  return parts;
}

function asEntries(raw: unknown): KipMemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: KipMemoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? clampMemoryText(rec.text) : "";
    if (!text) continue;
    const atISO =
      typeof rec.atISO === "string" && rec.atISO.trim()
        ? rec.atISO
        : new Date(0).toISOString();
    out.push({ text, atISO });
  }
  return out;
}

export function readKipPreferences(facts: BusinessFacts | null | undefined): KipMemoryEntry[] {
  return asEntries(facts?.kip_preferences);
}

export function readKipDecisions(facts: BusinessFacts | null | undefined): KipMemoryEntry[] {
  return asEntries(facts?.kip_decisions);
}

function truncateEntry(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= PROMPT_TEXT_MAX) return t;
  return `${t.slice(0, PROMPT_TEXT_MAX - 1)}…`;
}

/**
 * Short prompt block for Speak / persona / captions.
 * Empty string when nothing is stored.
 */
export function kipMemoryPromptBlock(facts: BusinessFacts | null | undefined): string {
  const prefs = readKipPreferences(facts).slice(-PROMPT_MAX_EACH);
  const decisions = readKipDecisions(facts).slice(-PROMPT_MAX_EACH);
  if (!prefs.length && !decisions.length) return "";

  const lines: string[] = [];
  if (prefs.length) {
    lines.push(
      `Remembered preferences: ${prefs.map((e) => truncateEntry(e.text)).join("; ")}.`,
    );
  }
  if (decisions.length) {
    lines.push(
      `Recent decisions: ${decisions.map((e) => truncateEntry(e.text)).join("; ")}.`,
    );
  }
  lines.push(
    "Honour these when drafting or advising. When the owner asks what you know about their brand or prefs, briefly list each remembered item — including never/don't content bans. Do not invent extras or paste raw JSON.",
  );
  return lines.join("\n");
}

/** Pure merge helper for remember_fact / recordKipMemory (testable without DB). */
export function mergeKipMemoryFact(
  facts: BusinessFacts | null | undefined,
  bucket: KipMemoryBucket,
  text: string,
  atISO = new Date().toISOString(),
): BusinessFacts {
  const atoms = splitMemoryAtoms(text);
  let base: BusinessFacts = { ...(facts ?? {}) };
  for (const atom of atoms) {
    const prev = asEntries(base[bucket]);
    // Dedupe exact text (case-insensitive) so re-stating a ban does not stack.
    const lower = atom.toLowerCase();
    if (prev.some((e) => e.text.toLowerCase() === lower)) continue;
    prev.push({ text: atom, atISO });
    base = { ...base, [bucket]: prev.slice(-MAX_MEMORY_ENTRIES) };
  }
  return base;
}

/**
 * Persist a short preference or decision on the brand and update the in-memory brand.
 * Compound blobs are split into atomic entries.
 */
export async function recordKipMemory(
  brand: Brand,
  text: string,
  bucket: KipMemoryBucket,
): Promise<BusinessFacts> {
  const atoms = splitMemoryAtoms(text);
  if (!atoms.length) return brand.facts ?? {};
  const merged = mergeKipMemoryFact(brand.facts, bucket, text);
  await query(`update brands set facts = $1::jsonb where id = $2`, [
    JSON.stringify(merged),
    brand.id,
  ]);
  brand.facts = merged;
  return merged;
}

/**
 * Conservative: only treat correction-learned notes that clearly sound like a
 * durable style preference (prefer/avoid/always/never…). Returns the text to
 * store, or null to skip.
 */
export function durablePrefFromCorrectionNote(note: string): string | null {
  const t = clampMemoryText(note);
  if (!t || t.length < 8) return null;
  // Skip raw before→after dumps from the fallback path.
  if (/^Edited:/i.test(t) || /"\s*->\s*"/.test(t)) return null;
  if (
    !/\b(prefer|avoid|always|never|don't|do not|no emoji|shorter|longer|punchy|formal|casual|exclamation)\b/i.test(
      t,
    )
  ) {
    return null;
  }
  return t;
}
