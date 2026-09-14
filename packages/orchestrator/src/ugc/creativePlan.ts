/**
 * Kip picks still / motion / voice per brief — best output without user knobs.
 *
 * Env pins (UGC_STILL_MODEL / UGC_MOTION_MODEL as concrete ids, UGC_VOICE_MODE=fixed)
 * still work; default is auto.
 */

import { getServerEnv, normalizeBrandVoiceProfile, type Brand } from "@pulse/shared";
import {
  MOTION_MODELS,
  STILL_MODELS,
  type UgcModelEndpoint,
  type UgcMotionModelId,
  type UgcStillModelId,
} from "./modelRouter.js";
import type { UgcVoiceSlot } from "./presets/voicePresets.js";

export type UgcPlanDestination = "organic" | "ads" | "both";

export type UgcCreativePlan = {
  mode: "auto" | "pinned";
  still: UgcModelEndpoint[];
  motion: UgcModelEndpoint[];
  voiceSlot: UgcVoiceSlot;
  reasons: {
    still: string;
    motion: string;
    voice: string;
  };
};

function envString(key: string, fallback: string): string {
  try {
    const e = getServerEnv() as Record<string, unknown>;
    const v = e[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  const raw = process.env[key];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function parseIdList(raw: string, allowed: string[]): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s));
}

function withFalOverrides(endpoints: UgcModelEndpoint[]): UgcModelEndpoint[] {
  return endpoints.map((base) => {
    if (base.id === "nano_banana") {
      return { ...base, falId: envString("FAL_NANO_BANANA_MODEL", base.falId) };
    }
    if (base.id === "flux_dev") {
      return { ...base, falId: envString("FAL_FLUX_STILL_MODEL", base.falId) };
    }
    if (base.id === "seedream") {
      return { ...base, falId: envString("FAL_SEEDREAM_MODEL", base.falId) };
    }
    if (base.id === "kling") {
      return { ...base, falId: envString("FAL_KLING_I2V_MODEL", base.falId) };
    }
    if (base.id === "seedance") {
      return { ...base, falId: envString("FAL_SEEDANCE_I2V_MODEL", base.falId) };
    }
    if (base.id === "wan") {
      return { ...base, falId: envString("FAL_WAN_I2V_MODEL", base.falId) };
    }
    return base;
  });
}

function chainFromIds(ids: string[], catalog: Record<string, UgcModelEndpoint>): UgcModelEndpoint[] {
  const seen = new Set<string>();
  const out: UgcModelEndpoint[] = [];
  for (const id of ids) {
    if (!catalog[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(catalog[id]!);
  }
  return withFalOverrides(out);
}

function isAuto(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return !t || t === "auto" || t === "best" || t === "kip";
}

export function voiceModeFixed(): boolean {
  const mode = envString("UGC_VOICE_MODE", "auto").toLowerCase();
  return mode === "fixed" || mode === "pin" || mode === "pinned";
}

export function pickStillIds(opts: {
  brief: string;
  hasProductRefs: boolean;
}): { ids: UgcStillModelId[]; reason: string } {
  const b = opts.brief.toLowerCase();
  if (/\b(illustrat|styliz|anime|cartoon|comic|painted|3d render|surreal)\b/i.test(b)) {
    return { ids: ["seedream", "flux_dev", "nano_banana"], reason: "stylized brief → Seedream primary" };
  }
  if (opts.hasProductRefs) {
    return { ids: ["nano_banana", "flux_dev", "seedream"], reason: "product photos present → Nano Banana for product lock" };
  }
  if (/\b(lifestyle|vibe|atmosphere|mood|aesthetic|scene|ambiance)\b/i.test(b)) {
    return { ids: ["flux_dev", "nano_banana", "seedream"], reason: "lifestyle brief without product refs → Flux aesthetics" };
  }
  return { ids: ["flux_dev", "nano_banana", "seedream"], reason: "no product refs → Flux primary (scene quality)" };
}

export function pickMotionIds(opts: {
  brief: string;
  destination: UgcPlanDestination;
}): { ids: UgcMotionModelId[]; reason: string } {
  const b = opts.brief.toLowerCase();
  if (/\b(cinematic|premium|luxury|film|dolly|tracking shot|smooth camera|epic|high[- ]end)\b/i.test(b)) {
    return { ids: ["seedance", "kling", "wan"], reason: "cinematic/premium language → Seedance primary" };
  }
  if (/\b(experimental|art[- ]?house|dreamy|surreal motion)\b/i.test(b)) {
    return { ids: ["wan", "seedance", "kling"], reason: "experimental motion ask → Wan primary" };
  }
  return {
    ids: ["kling", "seedance", "wan"],
    reason:
      opts.destination === "ads"
        ? "ad creative → Kling primary (reliable product I2V)"
        : "standard UGC → Kling primary with Seedance/Wan fallbacks",
  };
}

export function pickVoiceSlot(opts: {
  brief: string;
  brand?: Brand | null;
}): { slot: UgcVoiceSlot; reason: string } {
  const b = opts.brief.toLowerCase();
  const profile = normalizeBrandVoiceProfile(opts.brand?.brand_voice_profile);
  const tone = profile.tone.map((t) => t.toLowerCase()).join(" ");
  const guide = `${opts.brand?.voice_guide_md ?? ""} ${profile.notes.join(" ")}`.toLowerCase();
  const blob = `${b} ${tone} ${guide}`;

  if (/\b(calm|soft|soothing|spa|wellness|luxury|premium|serene|gentle|meditat|mindful)\b/i.test(blob)) {
    return { slot: "calm", reason: "calm/premium tone → calm VO" };
  }
  if (
    /\b(male voice|guy voice|masculine|deep voice|him\b|he\/him)\b/i.test(b) ||
    /\b(for (guys|men|dudes)|bro energy|masculine)\b/i.test(blob)
  ) {
    return { slot: "casual_m", reason: "male/masculine cues → casual_m" };
  }
  if (/\b(female voice|her voice|she\/her|feminine)\b/i.test(b)) {
    return { slot: "casual_f", reason: "female cues → casual_f" };
  }
  if (/\b(authoritative|bold|confident|founder|ceo)\b/i.test(tone) && /\b(male|man|men)\b/i.test(blob)) {
    return { slot: "casual_m", reason: "bold + male brand cues → casual_m" };
  }
  return { slot: "casual_f", reason: "default UGC → casual_f (best conversational baseline)" };
}

function pinnedStillChain(): UgcModelEndpoint[] | null {
  const primary = envString("UGC_STILL_MODEL", "auto");
  if (isAuto(primary)) return null;
  const allowed = Object.keys(STILL_MODELS);
  if (!allowed.includes(primary)) return null;
  const fallbacks = parseIdList(envString("UGC_STILL_FALLBACKS", "flux_dev,seedream"), allowed);
  const chain = chainFromIds([primary, ...fallbacks], STILL_MODELS);
  return chain.length ? chain : null;
}

function pinnedMotionChain(): UgcModelEndpoint[] | null {
  const primary = envString("UGC_MOTION_MODEL", "auto");
  if (isAuto(primary)) return null;
  const allowed = Object.keys(MOTION_MODELS);
  if (!allowed.includes(primary)) return null;
  const fallbacks = parseIdList(envString("UGC_MOTION_FALLBACKS", "seedance,wan"), allowed);
  const chain = chainFromIds([primary, ...fallbacks], MOTION_MODELS);
  return chain.length ? chain : null;
}

export function planUgcCreative(opts: {
  brief: string;
  brand?: Brand | null;
  hasProductRefs: boolean;
  destination?: UgcPlanDestination;
}): UgcCreativePlan {
  const destination = opts.destination ?? "organic";
  const pinnedStill = pinnedStillChain();
  const pinnedMotion = pinnedMotionChain();

  const stillPick = pickStillIds({ brief: opts.brief, hasProductRefs: opts.hasProductRefs });
  const motionPick = pickMotionIds({ brief: opts.brief, destination });
  const voicePick = pickVoiceSlot({ brief: opts.brief, brand: opts.brand });

  const still = pinnedStill ?? chainFromIds(stillPick.ids, STILL_MODELS);
  const motion = pinnedMotion ?? chainFromIds(motionPick.ids, MOTION_MODELS);

  const stillFinal = still.length ? still : withFalOverrides([STILL_MODELS.nano_banana]);
  const motionFinal = motion.length ? motion : withFalOverrides([MOTION_MODELS.kling]);

  const mode: UgcCreativePlan["mode"] =
    pinnedStill || pinnedMotion || voiceModeFixed() ? "pinned" : "auto";

  return {
    mode,
    still: stillFinal,
    motion: motionFinal,
    voiceSlot: voicePick.slot,
    reasons: {
      still: pinnedStill
        ? `pinned UGC_STILL_MODEL=${envString("UGC_STILL_MODEL", "")}`
        : stillPick.reason,
      motion: pinnedMotion
        ? `pinned UGC_MOTION_MODEL=${envString("UGC_MOTION_MODEL", "")}`
        : motionPick.reason,
      voice: voiceModeFixed()
        ? "pinned UGC_VOICE_MODE=fixed (+ ELEVENLABS_VOICE_ID if set)"
        : voicePick.reason,
    },
  };
}

export function summarizeCreativePlan(plan: UgcCreativePlan): string {
  return `stills ${plan.still.map((c) => c.id).join("→")}, motion ${plan.motion.map((c) => c.id).join("→")}, voice ${plan.voiceSlot}`;
}
