/** Curated Reel / Job-B hook formula bank (Jake-inspired). Local pick — no network. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentJob } from "./contentJobs.js";

export type HookFormula = {
  id: string;
  name: string;
  jobs: ContentJob[];
  template: string;
  example: string;
  on_screen?: string;
  ban?: string[];
};

const BANNED_OPENERS =
  /^(hey guys|hi guys|hello everyone|stop scrolling|wait for it|in this video|check this out|you won't believe)\b/i;

let cache: HookFormula[] | null = null;

function loadHooks(): HookFormula[] {
  if (cache) return cache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "data", "hooks.json"), "utf8");
    cache = JSON.parse(raw) as HookFormula[];
  } catch {
    cache = [];
  }
  return cache;
}

export function listHookFormulas(): HookFormula[] {
  return loadHooks();
}

/** Deterministic-ish pick of N formulas for a job (stable across a process). */
export function pickHookFormulas(job: ContentJob, n = 3): HookFormula[] {
  const all = loadHooks();
  const matched = all.filter((h) => h.jobs.includes(job));
  const pool = matched.length ? matched : all;
  if (!pool.length) return [];
  // Rotate by job char codes so different jobs get different shortlists.
  const offset = [...job].reduce((a, c) => a + c.charCodeAt(0), 0) % pool.length;
  const out: HookFormula[] = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    out.push(pool[(offset + i) % pool.length]!);
  }
  return out;
}

/** Simple specificity/stakes heuristic (0–10). */
export function scoreHookLine(line: string): number {
  const t = (line ?? "").trim();
  if (!t) return 0;
  if (BANNED_OPENERS.test(t)) return 0;
  let s = 3;
  if (/\d/.test(t)) s += 2; // numbers = stakes
  if (t.length >= 20 && t.length <= 90) s += 2;
  if (/\b(you|your)\b/i.test(t)) s += 1;
  if (/\b(stop|never|don't|secret|wrong|cost|steal)\b/i.test(t)) s += 1;
  if (/[!?]$/.test(t)) s += 0.5;
  if (/^(this|here|today)\b/i.test(t)) s -= 1;
  return Math.max(0, Math.min(10, s));
}

export function isBannedHookOpener(line: string): boolean {
  return BANNED_OPENERS.test((line ?? "").trim());
}

/** Prompt constraints for Reel drafts / Job B captions. */
export function hooksPromptBlock(job: ContentJob, n = 3): string {
  const picks = pickHookFormulas(job, n);
  if (!picks.length) {
    return "Hook rules: no greeting / stop-scrolling / in-this-video openers. Lead with a specific stake, number, or command.";
  }
  const lines = picks.map(
    (h, i) =>
      `${i + 1}. [${h.id}] ${h.name}: ${h.template} (e.g. "${h.example}")` +
      (h.on_screen ? ` | on-screen ≤6 words: ${h.on_screen}` : ""),
  );
  return [
    "Hook formula bank — pick ONE formula id and write a brand-specific line (spoken + optional on-screen). Ban: greeting, stop scrolling, in this video.",
    ...lines,
    "Prefer specificity and stakes. If a number is not in the proof bank, do not invent one.",
  ].join("\n");
}
