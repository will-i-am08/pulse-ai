/**
 * Niche look packs — Kive-style "studios" for Kip.
 * Each pack supplies three within-pack diversity briefs used by photo variants.
 */

export type LookPackId =
  | "cafe_warm"
  | "salon_clean"
  | "gym_punchy"
  | "tradie_daylight"
  | "food_hero"
  | "retail_shelf"
  | "florist_bloom"
  | "generic_faithful";

export type LookFrameGravity = "attention" | "north" | "centre" | "south" | "entropy";

/** Crop-first, subject-agnostic — never assume the photo contains the pack's hero object. */
const CROP_VARIANT_DIRECTIONS: [string, string, string] = [
  "Tight crop filling the frame with the real subject already in the photo. Extreme close. Shallow depth. Keep the actual object exact — do not replace it.",
  "Medium 45-degree framing with more of the real setting visible around the same subject. Different lighting from a close-up. Do not invent a new object.",
  "Wider establishing crop showing the full subject and surroundings. Clearly more environment than a close-up. Different colour grade. Same real subject.",
];

const CROP_VARIANT_FRAMES: [LookFrameGravity, LookFrameGravity, LookFrameGravity] = [
  "attention",
  "centre",
  "entropy",
];

export const PHOTO_EDIT_FAITHFUL_CORE =
  "Enhance this exact photograph in place. Adjust only lighting, exposure, colour grade, sharpness, and crop/framing of what is already visible. Keep the phone-shot character — slight grain, handheld crop, natural light — not a glossy studio ad, unless the request or brand photo_style asks for a more professional grade.";

export const PHOTO_EDIT_FAITHFUL_PROHIBITION =
  "Do not add, remove, replace, or restage any person, face, body, vehicle, van, storefront, uniform, tool, pipe, signage, text, logo, or trade prop that is not already clearly visible in the source photo. Do not change the subject category (e.g. food must stay food, not a job site).";

export type LookPack = {
  id: LookPackId;
  label: string;
  /** SMS-friendly short name */
  smsName: string;
  /** Niche / ICP keywords that map here */
  niches: string[];
  /** Shared grade direction for the pack */
  baseDirection: string;
  /** Three crop-first diversity briefs within the pack */
  variantDirections: [string, string, string];
  /** Mutually exclusive 4:5 crop gravities, one per look */
  variantFrames: [LookFrameGravity, LookFrameGravity, LookFrameGravity];
  negativeCues: string;
  defaultAspect: "4:5";
  motionHint?: string;
};

export const LOOK_PACKS_V1: Record<LookPackId, LookPack> = {
  cafe_warm: {
    id: "cafe_warm",
    label: "Café warm",
    smsName: "café-warm",
    niches: ["cafe", "café", "coffee", "bakery", "brunch", "tea", "espresso", "roaster"],
    baseDirection:
      "Warm daylight grade: soft golden light, gentle contrast, inviting colour, even exposure — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no fake menu boards, no relocated storefront, no invented plating",
    defaultAspect: "4:5",
    motionHint: "slow push-in on the cup or plate",
  },
  salon_clean: {
    id: "salon_clean",
    label: "Salon clean",
    smsName: "salon-clean",
    niches: ["salon", "hair", "beauty", "barber", "spa", "nails", "lash", "brow", "skincare clinic", "groomer", "dog groom", "pet groom"],
    baseDirection:
      "Clean editorial grade: bright even light, crisp whites, high clarity, neutral colour — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no fake before/after, no face morphing, no invented products",
    defaultAspect: "4:5",
    motionHint: "gentle orbit around the finished look",
  },
  gym_punchy: {
    id: "gym_punchy",
    label: "Gym punchy",
    smsName: "gym-punchy",
    niches: ["gym", "fitness", "pt", "personal trainer", "crossfit", "yoga", "pilates", "boxing", "martial"],
    baseDirection:
      "High-energy grade: punchy contrast, directional light, rich blacks, vivid colour — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no fake physiques, no invented PRs or medals",
    defaultAspect: "4:5",
    motionHint: "quick push-in on the effort beat",
  },
  tradie_daylight: {
    id: "tradie_daylight",
    label: "Tradie daylight",
    smsName: "tradie-daylight",
    niches: [
      "tradie",
      "plumber",
      "electrician",
      "sparky",
      "sparkie",
      "builder",
      "carpenter",
      "roofer",
      "landscap",
      "cleaner",
      "handyman",
      "mechanic",
    ],
    baseDirection:
      "Honest daylight grade: natural shadows, clear detail, neutral white balance, readable textures — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no fake certifications, no invented logos on vans",
    defaultAspect: "4:5",
    motionHint: "slow pan across the finished detail",
  },
  food_hero: {
    id: "food_hero",
    label: "Food hero",
    smsName: "food-hero",
    niches: ["restaurant", "food", "pizza", "burger", "sushi", "catering", "chef", "kitchen", "takeaway", "diner"],
    baseDirection:
      "Appetising grade: rich colour, shallow depth, warm highlights, clean exposure — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no invented garnishes, no fake steam that changes the dish",
    defaultAspect: "4:5",
    motionHint: "slow drizzle or steam drift if already in frame",
  },
  retail_shelf: {
    id: "retail_shelf",
    label: "Retail shelf",
    smsName: "retail-shelf",
    niches: ["retail", "shop", "boutique", "store", "ecommerce", "product", "candle", "jewellery", "jewelry", "fashion"],
    baseDirection:
      "Clean product grade: even light, accurate colour, tidy edges, sharp detail — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no logo redraw, no warped packaging, no fake claims on labels",
    defaultAspect: "4:5",
    motionHint: "gentle turntable orbit of the product",
  },
  florist_bloom: {
    id: "florist_bloom",
    label: "Florist bloom",
    smsName: "florist-bloom",
    niches: ["florist", "flower", "bloom", "bouquet", "floral", "posy"],
    baseDirection:
      "Soft natural grade: honest colour, gentle contrast, natural saturation, clean exposure — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no invented blooms, no swapped varieties, no fake shop signage",
    defaultAspect: "4:5",
    motionHint: "slow drift across petals",
  },
  generic_faithful: {
    id: "generic_faithful",
    label: "Faithful polish",
    smsName: "faithful polish",
    niches: [],
    baseDirection:
      "Faithful social polish: better light, colour fidelity, and sharpness while keeping the real subject recognisable — enhance only what is already in frame.",
    variantDirections: CROP_VARIANT_DIRECTIONS,
    variantFrames: CROP_VARIANT_FRAMES,
    negativeCues: "no fantasy props, no relocated premises, no fake text in frame",
    defaultAspect: "4:5",
  },
};

const PACK_IDS = Object.keys(LOOK_PACKS_V1) as LookPackId[];

export function getLookPack(id: string | null | undefined): LookPack {
  if (id && id in LOOK_PACKS_V1) return LOOK_PACKS_V1[id as LookPackId]!;
  return LOOK_PACKS_V1.generic_faithful;
}

/** Map niche / ICP / free text → default pack. */
export function resolveLookPackFromNiche(text: string | null | undefined): LookPack {
  const hay = (text ?? "").toLowerCase();
  if (!hay.trim()) return LOOK_PACKS_V1.generic_faithful;
  let best: LookPack = LOOK_PACKS_V1.generic_faithful;
  let bestScore = 0;
  for (const id of PACK_IDS) {
    const pack = LOOK_PACKS_V1[id]!;
    let score = 0;
    for (const n of pack.niches) {
      if (hay.includes(n)) score += n.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = pack;
    }
  }
  return best;
}

export type LookChangeIntent =
  | { kind: "set"; packId: LookPackId }
  | { kind: "hint"; hint: string }
  | null;

/** Parse SMS like "change look", "more lifestyle", "salon clean", "darker". */
export function parseLookChangeRequest(body: string | null | undefined): LookChangeIntent {
  if (!body) return null;
  const t = body.trim().toLowerCase();
  if (!t) return null;

  const wantsChange =
    /\b(change look|change the look|new look|different look|switch look|look pack)\b/i.test(t) ||
    /\b(more lifestyle|cleaner|darker|brighter|warmer|cooler|punchier|moodier)\b/i.test(t) ||
    /\b(cafe|café|salon|gym|tradie|food|retail|faithful|florist|bloom)\b/i.test(t);

  if (!wantsChange) return null;

  for (const id of PACK_IDS) {
    const pack = LOOK_PACKS_V1[id]!;
    if (t.includes(pack.id.replace(/_/g, " ")) || t.includes(pack.smsName) || t.includes(pack.label.toLowerCase())) {
      return { kind: "set", packId: id };
    }
    for (const n of pack.niches) {
      if (new RegExp(`\\b${n}\\b`, "i").test(t) && /\b(look|style|vibe|pack)\b/i.test(t)) {
        return { kind: "set", packId: id };
      }
    }
  }

  if (/\bcleaner\b|\bsalon\b/i.test(t)) return { kind: "set", packId: "salon_clean" };
  if (/\bwarm(er)?\b|\bcaf[eé]\b/i.test(t)) return { kind: "set", packId: "cafe_warm" };
  if (/\bpunch(y|ier)?\b|\bgym\b|\bfitness\b/i.test(t)) return { kind: "set", packId: "gym_punchy" };
  if (/\btradie\b|\bdaylight\b/i.test(t)) return { kind: "set", packId: "tradie_daylight" };
  if (/\bfood\b|\bhero\b|\brestaurant\b/i.test(t)) return { kind: "set", packId: "food_hero" };
  if (/\bflorist\b|\bbloom\b|\bbouquet\b/i.test(t)) return { kind: "set", packId: "florist_bloom" };
  if (/\bretail\b|\bshelf\b|\bproduct\b/i.test(t)) return { kind: "set", packId: "retail_shelf" };
  if (/\bdarker\b|\bmood(y|ier)?\b/i.test(t)) return { kind: "hint", hint: "darker moodier grade, still readable" };
  if (/\bbrighter\b/i.test(t)) return { kind: "hint", hint: "brighter cleaner light" };
  if (/\bmore lifestyle\b/i.test(t)) return { kind: "hint", hint: "more lifestyle context around the real subject" };
  if (/\bchange look|new look|different look|switch look\b/i.test(t)) {
    return { kind: "hint", hint: "fresh alternate look while staying faithful to the subject" };
  }
  return null;
}

export function listLookPackSms(): string {
  return PACK_IDS.map((id) => LOOK_PACKS_V1[id]!.smsName).join(", ");
}
