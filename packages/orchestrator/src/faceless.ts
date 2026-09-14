/**
 * Faceless accounts: nothing depicting the owner.
 *
 * Visuals:
 * - Do NOT show the owner's face, likeness, or "about me" presence.
 * - Other people ARE allowed (crowd, customers, models, stock talent).
 * - Prefer scenes that aren't personal portraits of the account holder.
 *
 * Naming:
 * - Do NOT stamp the owner's personal name onto creatives.
 * - A real business name (e.g. a café) MAY appear as a masthead.
 * - Faceless personal brands ("bill calder") stay nameless on tiles.
 */

export type FacelessBrandBits = {
  name?: string;
  facts?: {
    owner_name?: string;
    business_name?: string;
    faceless?: boolean;
    nameless?: boolean;
  } | null;
  onboarding_state?: {
    transcript?: Array<{ content?: string; body?: string }>;
    answers?: Record<string, string>;
  } | null;
};

type BrandFacts = NonNullable<FacelessBrandBits["facts"]>;
type OnboardingBits = NonNullable<FacelessBrandBits["onboarding_state"]>;

const BUSINESS_NAME_HINT =
  /\b(cafe|café|coffee|kitchen|bakery|studio|salon|gym|clinic|dental|barber|shop|store|co\b|company|agency|media|lab|labs|restaurant|bar|inn|hotel|boutique|market|garage|motors|auto|fitness|yoga|spa|brewery|winery|farm|realty|law|legal|plumbing|electric)\b/i;

function factsOf(brand: FacelessBrandBits): BrandFacts {
  return (brand.facts ?? {}) as BrandFacts;
}

function onboardingOf(brand: FacelessBrandBits): OnboardingBits {
  return (brand.onboarding_state ?? {}) as OnboardingBits;
}

function transcriptMentionsFaceless(brand: FacelessBrandBits): boolean {
  const state = onboardingOf(brand);
  if (state.answers?.faceless === "1" || /^true$/i.test(state.answers?.faceless ?? "")) {
    return true;
  }
  return (state.transcript ?? []).some((t) => /\bfaceless\b/i.test(`${t.content ?? ""} ${t.body ?? ""}`));
}

/** Explicit faceless flag, or onboarding transcript mention. */
export function isFacelessBrand(brand: FacelessBrandBits): boolean {
  if (factsOf(brand).faceless === true) return true;
  return transcriptMentionsFaceless(brand);
}

/**
 * True when we should treat the brand display name as a person's name
 * (first + last), not a business marque like "Sunrise Cafe".
 */
export function looksLikePersonalBrandName(brand: FacelessBrandBits): boolean {
  const name = (brand.name ?? "").trim();
  if (!name) return false;
  if (BUSINESS_NAME_HINT.test(name)) return false;
  const owner = (factsOf(brand).owner_name ?? "").trim().toLowerCase();
  if (owner) {
    const first = owner.split(/\s+/)[0];
    if (first && name.toLowerCase().includes(first)) return true;
  }
  // Two+ alphabetic tokens, no business hint → likely "Bill Calder".
  const parts = name.split(/\s+/).filter((p) => /[a-zA-Z]{2,}/.test(p));
  return parts.length >= 2 && parts.length <= 4;
}

/**
 * Faceless ⇒ nameless for *personal* stamps unless they opted into naming.
 * Also nameless when facts.nameless is set.
 * Business marques (café name) are NOT forced nameless just because faceless.
 */
export function isNamelessCreative(brand: FacelessBrandBits): boolean {
  const facts = factsOf(brand);
  if (facts.nameless === true) return true;
  if (facts.nameless === false) return false;
  if (!isFacelessBrand(brand)) return false;
  // Faceless personal brands: no name stamp. Faceless business pages can keep marque.
  return looksLikePersonalBrandName(brand) || !brand.name?.trim();
}

/** Personal names we should not stamp onto creatives for this brand. */
export function personalNameTokens(brand: FacelessBrandBits): string[] {
  const facts = factsOf(brand);
  const tokens = new Set<string>();
  const sources: string[] = [];
  if (facts.owner_name?.trim()) sources.push(facts.owner_name);
  // Only strip brand.name when it looks like a person, never strip "Sunrise Cafe".
  if (looksLikePersonalBrandName(brand) && brand.name?.trim()) sources.push(brand.name);
  for (const raw of sources) {
    for (const part of raw.trim().split(/\s+/)) {
      const t = part.replace(/[^a-zA-Z]/g, "");
      if (t.length >= 2) tokens.add(t.toLowerCase());
    }
  }
  return [...tokens];
}

/**
 * Masthead burned onto photo tiles / quote cards.
 * - Explicit nameless / faceless personal → empty (no "BILL CALDER").
 * - Real business name (café etc.) → brand / business_name stamp is OK.
 */
export function overlayMasthead(brand: FacelessBrandBits): string {
  if (isNamelessCreative(brand)) return "";
  const facts = factsOf(brand);
  const business = (facts.business_name ?? "").trim();
  if (business) return business.toUpperCase();
  return (brand.name ?? "").trim().toUpperCase();
}

/** Prompt line for draft LLMs when the account is faceless / nameless-personal. */
export function facelessPromptLine(brand: FacelessBrandBits): string | null {
  if (!isFacelessBrand(brand) && !isNamelessCreative(brand)) return null;
  const names = personalNameTokens(brand);
  const avoid = names.length
    ? ` Never use these personal names in captions or headlines: ${names.join(", ")}.`
    : "";
  const face =
    " Never depict the owner (no selfie, no portrait of them, nothing that is 'about them' on camera)." +
    " Other people are fine — customers, crowds, models, stock talent — as long as it is not the owner.";
  return `This is a FACELESS account: creatives must not feature the owner.${face} Write as a guide/brand voice, not a personal diary.${avoid}`;
}

/**
 * Photo-prompt constraints for faceless brands.
 * Blocks owner likeness — does NOT ban people in general.
 */
export function facelessPhotoConstraint(brand: FacelessBrandBits): string {
  if (!isFacelessBrand(brand)) return "";
  const names = personalNameTokens(brand);
  const who = names.length ? ` (not ${names.join(" / ")})` : "";
  return (
    `Faceless creative: do not depict the account owner${who} — no owner selfie, no owner portrait, ` +
    "nothing that presents as the owner's personal appearance. " +
    "Other people are allowed (crowd, customers, models, stock talent)."
  );
}

/** Strip owner personal-name leaks from caption/headline copy. */
export function stripPersonalNames(text: string, brand: FacelessBrandBits): string {
  let out = text;
  for (const token of personalNameTokens(brand)) {
    const re = new RegExp(`\\b${token}\\b`, "gi");
    out = out.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  const cleaned = out.replace(/^[\s,.:;\-]+|[\s,.:;\-]+$/g, "").trim();
  return cleaned || text;
}
