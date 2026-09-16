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

export type LookPack = {
  id: LookPackId;
  label: string;
  /** SMS-friendly short name */
  smsName: string;
  /** Niche / ICP keywords that map here */
  niches: string[];
  /** Shared grade direction for the pack */
  baseDirection: string;
  /** Three diversity briefs (lighting / scene / mood) within the pack */
  variantDirections: [string, string, string];
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
      "Warm café atmosphere: soft golden window light, cosy textures, steam and ceramic if present. Keep the real food, drink, and premises truthful.",
    variantDirections: [
      "Warm morning window light, soft highlights on the real subject, gentle steam/atmosphere if natural — keep the product/place exact.",
      "Closer hero framing of the real item on the counter, shallow depth, creamy bokeh — do not invent a different dish or cup.",
      "Moody late-afternoon café grade: richer shadows still readable, wood and ceramic tones — same subject, cleaner clutter.",
    ],
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
      "Clean salon editorial: bright even light, crisp whites, polished mirrors and tools. Keep the real cut, colour, and space accurate.",
    variantDirections: [
      "Bright clean salon light, soft fill, crisp whites — keep the real hair/skin/nails exact.",
      "Soft beauty-editorial grade with gentle glow on the real subject — no face reshape, no fake results.",
      "Minimal mirror-reflection framing of the real scene, tidy background, cool-neutral whites.",
    ],
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
      "High-energy fitness look: punchy contrast, directional light, sweat and grit if present. Keep the real athletes, gear, and gym truthful.",
    variantDirections: [
      "Punchy directional gym light, strong contrast, keep the real person and equipment exact.",
      "Low-angle hero of the real lift/move, kinetic energy, readable shadows — no invented medals or physiques.",
      "Clean morning gym window light on the real scene, sharper detail, less clutter.",
    ],
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
      "Honest daylight on real work: clear detail on tools, materials, and finished jobs. Keep the real site and craftsmanship truthful.",
    variantDirections: [
      "Wide establishing daylight shot of the real job site, switchboard, or van — keep materials and finished work exact.",
      "Tight macro of the real install (wiring, fitting, joint, finish) with tidy framing and a clearly different crop from a wide shot.",
      "Warm late-day wrap on the real tools or completed board — different colour grade and angle from the other two looks, no invented brand logos.",
    ],
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
      "Food-hero photography: appetising light, rich colour on the real dish, shallow depth. Never invent plating that isn't there.",
    variantDirections: [
      "Overhead food-hero of the real dish, appetising light, tidy crumbs — keep plating exact.",
      "45-degree hero of the real plate with soft side light and shallow depth.",
      "Close bite-detail of the real food texture, warm grade, no invented garnishes.",
    ],
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
      "Clean product/retail look: accurate packaging, labels, and materials. Improve light and tidiness without distorting the SKU.",
    variantDirections: [
      "Clean product shelf light — keep packaging, labels, and materials exact.",
      "Lifestyle surface staging around the real product (table, linen) without changing the SKU.",
      "Soft studio-grade light on the real item, neutral backdrop tidy-up — no logo redraw.",
    ],
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
      "Bloom-true floral photography: honest colour on the real stems and wrap. Keep the actual arrangement recognisable — never swap flowers.",
    variantDirections: [
      "Bright daylight close-up of the real blooms, crisp petals, shallow depth — keep the actual arrangement exact.",
      "Darker editorial grade on the same flowers, moody shadows still readable, richer colour — do not change the bouquet.",
      "Lifestyle wrapping or counter framing of the real arrangement (hands or kraft paper only if already in frame) — same flowers, wider context.",
    ],
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
      "Faithful social polish: better light, colour fidelity, and tidiness while keeping the real subject recognisable.",
    variantDirections: [
      "Brighter even light and cleaner colour, slightly wider scene — keep the real subject exact.",
      "Dramatic tighter crop with shallow depth and darker readable edges — same subject, clearly a different framing.",
      "Cooler desaturated grade, offset composition, tidy background — same subject, a third distinct look.",
    ],
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
