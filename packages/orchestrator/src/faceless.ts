/**
 * Faceless accounts: no face on camera, and usually nameless in creatives too —
 * don't burn the owner's personal name onto slides or into captions.
 */

export type FacelessBrandBits = {
  name?: string;
  facts?: {
    owner_name?: string;
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
 * Faceless ⇒ treat as nameless in creatives unless they opted into naming.
 * Also nameless when facts.nameless is set.
 */
export function isNamelessCreative(brand: FacelessBrandBits): boolean {
  const facts = factsOf(brand);
  if (facts.nameless === true) return true;
  if (facts.nameless === false) return false;
  return isFacelessBrand(brand);
}

/** Personal names we should not stamp onto creatives for this brand. */
export function personalNameTokens(brand: FacelessBrandBits): string[] {
  const facts = factsOf(brand);
  const tokens = new Set<string>();
  for (const raw of [brand.name, facts.owner_name]) {
    if (!raw?.trim()) continue;
    for (const part of raw.trim().split(/\s+/)) {
      const t = part.replace(/[^a-zA-Z]/g, "");
      if (t.length >= 2) tokens.add(t.toLowerCase());
    }
  }
  return [...tokens];
}

/**
 * Masthead burned onto photo tiles / quote cards.
 * Faceless/nameless → empty (no "BILL CALDER" stamp).
 */
export function overlayMasthead(brand: FacelessBrandBits): string {
  if (isNamelessCreative(brand)) return "";
  return (brand.name ?? "").trim().toUpperCase();
}

/** Prompt line for draft LLMs when the account is faceless/nameless. */
export function facelessPromptLine(brand: FacelessBrandBits): string | null {
  if (!isFacelessBrand(brand) && !isNamelessCreative(brand)) return null;
  const names = personalNameTokens(brand);
  const avoid = names.length
    ? ` Never use these personal names in captions or headlines: ${names.join(", ")}.`
    : "";
  return `This is a FACELESS account (nameless in creatives too): never show or name the owner on-camera or in copy. Write as a guide/brand voice, not a personal diary.${avoid}`;
}

/** Strip owner/brand personal name leaks from caption/headline copy. */
export function stripPersonalNames(text: string, brand: FacelessBrandBits): string {
  let out = text;
  for (const token of personalNameTokens(brand)) {
    const re = new RegExp(`\\b${token}\\b`, "gi");
    out = out.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  const cleaned = out.replace(/^[\s,.:;\-]+|[\s,.:;\-]+$/g, "").trim();
  return cleaned || text;
}
