/** Versioned UGC script presets — seeded from production UGC practice (v1). */

export const UGC_PRESET_VERSION = "v1" as const;

export type UgcAngle = "pain_killer" | "myth_bust" | "before_after" | "speed" | "comparison";

export const UGC_ANGLES: UgcAngle[] = [
  "pain_killer",
  "myth_bust",
  "before_after",
  "speed",
  "comparison",
];

export const SCRIPT_SYSTEM = `You write short-form UGC ad scripts that sound like a real person texting a friend — never like a brand ad.

Structure (strict):
Hook 0-2s → Context 2-5s → ONE proof 5-18s → optional Mechanism → CTA last 2-4s

Rules:
- ONE angle, ONE proof moment (no feature laundry lists)
- Hook MUST include ONE constraint: time / cost / niche / "without X"
- 6–10 word hooks; contractions; conversational
- Ban: "Introducing", "innovative", "game-changer", "revolutionize", "don't miss out"
- Soft CTA ("link below", "grab it while it's on") not shouty
- Word budget 35–90 total for 15–30s
- Output ONLY JSON:
{
  "angle": "pain_killer|myth_bust|before_after|speed|comparison",
  "hook": "...",
  "script": "full spoken VO with ... pauses and short sentences",
  "scenes": [
    {"role":"hook"|"proof"|"cta","vo":"spoken line for this scene","visual":"what we see (product-first, phone-feel)","seconds":4}
  ],
  "cta": "..."
}
Prefer 3 scenes. Product must appear in proof scene.`;

export const SCRIPT_BANNED = [
  "introducing our",
  "innovative",
  "game-changer",
  "revolutionize",
  "limited time only!!!",
  "act now",
];

export function pickAngle(hint?: string | null): UgcAngle {
  const t = (hint ?? "").toLowerCase();
  if (/myth|everyone says|wrong/.test(t)) return "myth_bust";
  if (/before|after|transform|result/.test(t)) return "before_after";
  if (/fast|minute|quick|speed/.test(t)) return "speed";
  if (/vs|versus|compared|better than/.test(t)) return "comparison";
  return "pain_killer";
}
