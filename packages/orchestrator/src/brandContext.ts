import {
  query,
  type Brand,
  type BrandIcp,
  type BrandOffers,
  type BrandPainPoints,
  type BrandPositioning,
  type PainPoint,
  type VisualProfile,
} from "@pulse/shared";
import { callLLM } from "./llm.js";

// Phase B brand objects: ICP, pain points, positioning, offers, visual prefs.
// SMS is the source of truth — owner updates by natural language; research helpers
// propose drafts that still need owner confirmation before they become truth.

export type BrandContextKind = "icp" | "pains" | "positioning" | "offers" | "visual";

const KIND_SIGNAL: Record<BrandContextKind, RegExp> = {
  icp: /\b(icp|ideal\s+customer|target\s+(audience|customer|market)|who\s+we\s+(serve|sell\s+to)|customer\s+profile|update\s+our\s+icp)\b/i,
  pains: /\b(pain\s*points?|customer\s+pains?|what\s+they\s+struggle|frustrat)/i,
  positioning: /\b(positioning|one[\s-]?liner|we\s+are\s+the|our\s+positioning|differentiat)/i,
  offers: /\b(our\s+offer|primary\s+offer|update\s+(the\s+)?offer|bonuses?|proof\s+points?|claim\s+constraints?|special\s+offer|promo(tion)?)\b/i,
  visual: /\b(brand\s+(look|colours?|colors?|fonts?|visual)|our\s+(colours?|colors?|fonts?|logo|aesthetic|photo\s+treatment)|visual\s+(profile|prefs?|style)|update\s+our\s+(look|visuals?))\b/i,
};

/** Does this message look like an ICP / pains / positioning / offers / visual update? */
export function looksLikeBrandContextUpdate(body: string | null | undefined): boolean {
  return detectBrandContextKind(body) != null;
}

/** Which brand-context object the message is most likely updating. */
export function detectBrandContextKind(body: string | null | undefined): BrandContextKind | null {
  if (!body?.trim()) return null;
  // Prefer more specific offer/visual/positioning before broad ICP.
  const order: BrandContextKind[] = ["offers", "visual", "positioning", "pains", "icp"];
  for (const kind of order) {
    if (KIND_SIGNAL[kind].test(body)) return kind;
  }
  // Soft patterns for "our offer is…" / "our positioning is…"
  if (/\bour\s+offer\s+is\b/i.test(body)) return "offers";
  if (/\bour\s+positioning\s+is\b/i.test(body)) return "positioning";
  if (/\bupdate\s+our\s+icp\b/i.test(body)) return "icp";
  return null;
}

export function mergeIcp(existing: BrandIcp | null | undefined, incoming: BrandIcp): BrandIcp {
  const out: BrandIcp = { ...(existing ?? {}) };
  if (incoming.segments?.length) out.segments = incoming.segments;
  if (incoming.demographics) out.demographics = incoming.demographics;
  if (incoming.jtbd?.length) out.jtbd = incoming.jtbd;
  if (incoming.notes) out.notes = incoming.notes;
  if (incoming.researched != null) out.researched = incoming.researched;
  if (incoming.confirmed_at) out.confirmed_at = incoming.confirmed_at;
  out.updated_at = new Date().toISOString();
  return out;
}

export function mergePainPoints(
  existing: BrandPainPoints | null | undefined,
  incoming: BrandPainPoints,
): BrandPainPoints {
  const prev = existing?.items ?? [];
  const next = incoming.items ?? [];
  if (!next.length) return { ...(existing ?? {}), updated_at: new Date().toISOString() };
  const map = new Map<string, PainPoint>();
  for (const p of prev) map.set(p.text.toLowerCase().trim(), p);
  for (const p of next) {
    const key = p.text.toLowerCase().trim();
    if (!key) continue;
    map.set(key, { ...map.get(key), ...p, text: p.text.trim() });
  }
  return { items: [...map.values()], updated_at: new Date().toISOString() };
}

export function mergePositioning(
  existing: BrandPositioning | null | undefined,
  incoming: BrandPositioning,
): BrandPositioning {
  return {
    ...(existing ?? {}),
    ...(incoming.one_liner ? { one_liner: incoming.one_liner } : {}),
    ...(incoming.category ? { category: incoming.category } : {}),
    ...(incoming.differentiation ? { differentiation: incoming.differentiation } : {}),
    updated_at: new Date().toISOString(),
  };
}

export function mergeOffers(
  existing: BrandOffers | null | undefined,
  incoming: BrandOffers,
): BrandOffers {
  const out: BrandOffers = { ...(existing ?? {}) };
  if (incoming.primary) out.primary = incoming.primary;
  if (incoming.bonuses?.length) {
    out.bonuses = uniqueStrings([...(out.bonuses ?? []), ...incoming.bonuses]);
  }
  if (incoming.proof?.length) {
    out.proof = uniqueStrings([...(out.proof ?? []), ...incoming.proof]);
  }
  if (incoming.cta) out.cta = incoming.cta;
  if (incoming.booking_link) out.booking_link = incoming.booking_link;
  if (incoming.claim_constraints?.length) {
    out.claim_constraints = uniqueStrings([
      ...(out.claim_constraints ?? []),
      ...incoming.claim_constraints,
    ]);
  }
  out.updated_at = new Date().toISOString();
  return out;
}

export function mergeVisual(
  existing: VisualProfile | null | undefined,
  incoming: VisualProfile,
): VisualProfile {
  const out: VisualProfile = { ...(existing ?? {}) };
  if (incoming.colors?.length) out.colors = incoming.colors;
  if (incoming.fonts?.length) out.fonts = incoming.fonts;
  if (incoming.logo_url) out.logo_url = incoming.logo_url;
  if (incoming.aesthetic) out.aesthetic = incoming.aesthetic;
  if (incoming.aesthetic_notes) out.aesthetic_notes = incoming.aesthetic_notes;
  if (incoming.photo_treatment) out.photo_treatment = incoming.photo_treatment;
  if (incoming.aspect_ratio) out.aspect_ratio = incoming.aspect_ratio;
  return out;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Compact brand-context block for caption / persona / campaign prompts.
 * Never invents missing ICP/offers — empty sections stay empty.
 */
export function brandContextForPrompt(brand: Brand): string {
  const lines: string[] = [];
  const icp = brand.icp ?? {};
  if (icp.segments?.length || icp.demographics || icp.jtbd?.length) {
    lines.push("ICP (use when relevant; do not invent a fake customer if empty):");
    if (icp.segments?.length) lines.push(`- Segments: ${icp.segments.join("; ")}`);
    if (icp.demographics) lines.push(`- Demographics: ${icp.demographics}`);
    if (icp.jtbd?.length) lines.push(`- Jobs to be done: ${icp.jtbd.join("; ")}`);
    if (icp.notes) lines.push(`- Notes: ${icp.notes}`);
  }

  const pains = (brand.pain_points?.items ?? []).filter((p) => p.confirmed !== false);
  if (pains.length) {
    lines.push("Confirmed pain points (prefer these; no fabricated sensitive claims):");
    for (const p of pains.slice(0, 8)) lines.push(`- ${p.text}`);
  }

  const pos = brand.positioning ?? {};
  if (pos.one_liner || pos.category || pos.differentiation) {
    lines.push("Positioning:");
    if (pos.one_liner) lines.push(`- ${pos.one_liner}`);
    if (pos.category) lines.push(`- Category: ${pos.category}`);
    if (pos.differentiation) lines.push(`- Differentiation: ${pos.differentiation}`);
  }

  const offers = brand.offers ?? {};
  if (
    offers.primary ||
    offers.bonuses?.length ||
    offers.proof?.length ||
    offers.cta ||
    offers.booking_link ||
    offers.claim_constraints?.length
  ) {
    lines.push("Offers (NEVER invent discounts, awards, or testimonials not listed here or in business facts):");
    if (offers.primary) lines.push(`- Primary: ${offers.primary}`);
    if (offers.bonuses?.length) lines.push(`- Bonuses: ${offers.bonuses.join("; ")}`);
    if (offers.proof?.length) lines.push(`- Proof: ${offers.proof.join("; ")}`);
    if (offers.cta) lines.push(`- CTA: ${offers.cta}`);
    if (offers.booking_link) lines.push(`- Booking: ${offers.booking_link}`);
    if (offers.claim_constraints?.length) {
      lines.push(`- Claim constraints: ${offers.claim_constraints.join("; ")}`);
    }
  }

  const voice = brand.brand_voice_profile as {
    proof_bank?: string[];
    positions?: string[];
  } | null | undefined;
  if (voice?.proof_bank?.length) {
    lines.push("Proof bank (never invent numbers beyond these):");
    for (const p of voice.proof_bank.slice(0, 12)) lines.push(`- ${p}`);
  }
  if (voice?.positions?.length) {
    lines.push("Brand positions (take these stands when relevant):");
    for (const p of voice.positions.slice(0, 8)) lines.push(`- ${p}`);
  }

  return lines.join("\n");
}

/** Persist helpers — return confirmation SMS text or null if nothing extracted. */
export async function updateBrandContextFromMessage(
  brand: Brand,
  message: string,
  kindHint?: BrandContextKind | null,
): Promise<string | null> {
  const kind = kindHint ?? detectBrandContextKind(message);
  if (!kind) return null;

  if (kind === "icp") return updateIcpFromMessage(brand, message);
  if (kind === "pains") return updatePainsFromMessage(brand, message);
  if (kind === "positioning") return updatePositioningFromMessage(brand, message);
  if (kind === "offers") return updateOffersFromMessage(brand, message);
  return updateVisualFromMessage(brand, message);
}

async function updateIcpFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract ICP updates from the owner message into JSON.",
    'Shape: {"segments":[""],"demographics":"","jtbd":[""],"notes":""}',
    "Include ONLY fields they stated. If nothing ICP-related, output {}.",
    'Also "reply": one short friendly SMS confirming what you saved.',
    'Wrap as {"icp":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { icp?: BrandIcp; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 400 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.icp ?? {};
  if (!incoming || !Object.keys(incoming).length) return null;
  const merged = mergeIcp(brand.icp, {
    ...incoming,
    researched: false,
    confirmed_at: new Date().toISOString(),
  });
  await query(`update brands set icp = $1::jsonb where id = $2`, [JSON.stringify(merged), brand.id]);
  return parsed.reply?.trim() || "Got it — I've updated your ICP.";
}

async function updatePainsFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract customer pain points the owner states or confirms.",
    'Shape: {"items":[{"text":"","source":"owner","confirmed":true}]}',
    "Only real pains they mentioned. Empty {} if none.",
    'Also "reply": short SMS confirmation. Wrap {"pains":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { pains?: BrandPainPoints; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 400 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.pains ?? {};
  if (!incoming.items?.length) return null;
  const merged = mergePainPoints(brand.pain_points, {
    items: incoming.items.map((p) => ({
      text: p.text,
      source: p.source ?? "owner",
      confirmed: p.confirmed !== false,
    })),
  });
  await query(`update brands set pain_points = $1::jsonb where id = $2`, [
    JSON.stringify(merged),
    brand.id,
  ]);
  return parsed.reply?.trim() || "Saved those pain points.";
}

async function updatePositioningFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract brand positioning from the owner message.",
    'Shape: {"one_liner":"","category":"","differentiation":""}',
    "Only what they stated. Empty {} if none.",
    'Also "reply": short SMS. Wrap {"positioning":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { positioning?: BrandPositioning; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 300 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.positioning ?? {};
  if (!incoming.one_liner && !incoming.category && !incoming.differentiation) return null;
  const merged = mergePositioning(brand.positioning, incoming);
  await query(`update brands set positioning = $1::jsonb where id = $2`, [
    JSON.stringify(merged),
    brand.id,
  ]);
  return parsed.reply?.trim() || "Positioning updated.";
}

async function updateOffersFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract offer-stack updates. Never invent discounts or awards they did not state.",
    'Shape: {"primary":"","bonuses":[""],"proof":[""],"cta":"","booking_link":"","claim_constraints":[""]}',
    "Only stated fields. Empty {} if none.",
    'Also "reply": short SMS. Wrap {"offers":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { offers?: BrandOffers; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 450 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.offers ?? {};
  if (!incoming || !Object.keys(incoming).length) return null;
  const merged = mergeOffers(brand.offers, incoming);
  await query(`update brands set offers = $1::jsonb where id = $2`, [
    JSON.stringify(merged),
    brand.id,
  ]);
  return parsed.reply?.trim() || "Offer details saved — I'll use these on the next draft.";
}

async function updateVisualFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract visual brand preferences into JSON.",
    'Shape: {"colors":["#hex"],"fonts":[""],"logo_url":"","aesthetic":"","aesthetic_notes":"","photo_treatment":"","aspect_ratio":""}',
    "Prefer hex colours when they name colours. Only stated fields. Empty {} if none.",
    'Also "reply": short SMS. Wrap {"visual":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { visual?: VisualProfile; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 350 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.visual ?? {};
  if (!incoming || !Object.keys(incoming).length) return null;
  const merged = mergeVisual(brand.visual, incoming);
  await query(`update brands set visual = $1::jsonb where id = $2`, [
    JSON.stringify(merged),
    brand.id,
  ]);
  return parsed.reply?.trim() || "Got it — I've updated your brand look.";
}

/** Light research stub: propose ICP from website / brand name via LLM (+ optional web search). */
export async function researchIcp(brand: Brand): Promise<BrandIcp> {
  const system = [
    `Propose an ICP for "${brand.name}"${brand.website ? ` (${brand.website})` : ""}.`,
    brand.facts?.differentiators ? `Known about them: ${brand.facts.differentiators}` : "",
    'Output ONLY JSON: {"segments":[""],"demographics":"","jtbd":[""],"notes":""}',
    "Be specific but humble — this is a draft for the owner to confirm, not truth yet.",
    "If you truly cannot tell, return empty arrays/strings rather than inventing a fake customer.",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: "Propose the ICP now." }],
      maxTokens: 350,
      webSearch: brand.website ? 3 : false,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as BrandIcp;
    return {
      segments: Array.isArray(parsed.segments) ? parsed.segments.filter(Boolean).slice(0, 5) : [],
      demographics: typeof parsed.demographics === "string" ? parsed.demographics : "",
      jtbd: Array.isArray(parsed.jtbd) ? parsed.jtbd.filter(Boolean).slice(0, 5) : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      researched: true,
      updated_at: new Date().toISOString(),
    };
  } catch {
    return { segments: [], jtbd: [], researched: true, updated_at: new Date().toISOString() };
  }
}

/** Light research stub: propose pain language from niche / web search. */
export async function researchPainPoints(brand: Brand): Promise<BrandPainPoints> {
  const system = [
    `Research likely customer pain points for "${brand.name}"${brand.website ? ` (${brand.website})` : ""}.`,
    'Output ONLY JSON: {"items":[{"text":"","source":"research","confirmed":false}]}',
    "3-6 short pains in the customer's language. Mark confirmed=false — owner must confirm.",
    "No sensitive medical/legal fabrications. If unsure, return fewer items.",
  ].join("\n");
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: "List likely pains." }],
      maxTokens: 400,
      webSearch: 4,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as BrandPainPoints;
    const items = (parsed.items ?? [])
      .filter((p) => p?.text)
      .slice(0, 6)
      .map((p) => ({
        text: String(p.text).trim(),
        source: "research" as const,
        confirmed: false,
      }));
    return { items, updated_at: new Date().toISOString() };
  } catch {
    return { items: [], updated_at: new Date().toISOString() };
  }
}

/** Propose a positioning one-liner from facts + ICP + pains (draft only). */
export async function proposePositioning(brand: Brand): Promise<BrandPositioning> {
  const ctx = brandContextForPrompt(brand);
  const system = [
    `Propose positioning for "${brand.name}".`,
    ctx ? `Known context:\n${ctx}` : "Little context on file — keep it tentative.",
    'Output ONLY JSON: {"one_liner":"","category":"","differentiation":""}',
    "Do not invent offers, awards, or discounts. One clear one-liner.",
  ].join("\n");
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: "Propose positioning." }],
      maxTokens: 200,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as BrandPositioning;
    return {
      one_liner: typeof parsed.one_liner === "string" ? parsed.one_liner : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
      differentiation: typeof parsed.differentiation === "string" ? parsed.differentiation : "",
      updated_at: new Date().toISOString(),
    };
  } catch {
    return { updated_at: new Date().toISOString() };
  }
}

/** Persist a researched ICP draft (not auto-confirmed). */
export async function saveIcpDraft(brandId: string, icp: BrandIcp): Promise<void> {
  await query(`update brands set icp = $1::jsonb where id = $2`, [
    JSON.stringify({ ...icp, researched: true, confirmed_at: undefined }),
    brandId,
  ]);
}

export async function savePainPointsDraft(brandId: string, pains: BrandPainPoints): Promise<void> {
  await query(`update brands set pain_points = $1::jsonb where id = $2`, [
    JSON.stringify(pains),
    brandId,
  ]);
}

export async function savePositioningDraft(
  brandId: string,
  positioning: BrandPositioning,
): Promise<void> {
  await query(`update brands set positioning = $1::jsonb where id = $2`, [
    JSON.stringify(positioning),
    brandId,
  ]);
}
