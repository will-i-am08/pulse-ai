import {
  query,
  queryOne,
  type Brand,
  type BusinessFacts,
  type BrandOffers,
  type LinkOffer,
  type LinkOfferMode,
  type PendingDestinationLink,
  type Platform,
  type Post,
  type PostFormat,
} from "@pulse/shared";
import { isBlockedHost, safePublicUrl } from "./research.js";

// Destination / booking URLs for organic captions, Stories CTAs, and ad click-throughs.
// Distinct from SMS connect deep-links (`/c/[token]`). Owner must confirm before save/use.

const BOOKING_HOST_RE =
  /(calendly\.com|acuityscheduling\.com|square\.site|squareup\.com|booksy\.com|setmore\.com|mindbodyonline\.com|mindbody\.io|styleseat\.com|vagaro\.com|fresha\.com|booker\.com|schedulicity\.com|appointy\.com|simplybook\.me|gettimely\.com|jane\.app|cliniko\.com|boulevard\.io|glossgenius\.com)/i;

const BOOKING_PATH_RE =
  /\/(book|booking|book-now|booknow|appointments?|schedule|scheduler|reserve|reservation|consult|consultation)(\/|$|\?)/i;

const BOOKING_TEXT_RE =
  /\b(book\s*now|book\s*(online|a|an|your)|schedule|appointment|reservations?|book\s*here)\b/i;

const DEFAULT_PATHS = [
  "/book",
  "/booking",
  "/book-now",
  "/appointments",
  "/appointment",
  "/schedule",
  "/contact",
  "/consult",
];

const DEFAULT_KEYWORD = "LINK";

export type DiscoveredLink = {
  url: string;
  score: number;
  reason: string;
};

export type DestinationLinkContext = "post" | "ads" | "onboarding" | "update" | "story";

/** Confirmed booking URL: facts.booking_link → offers.booking_link → null. */
export function resolveDestinationLink(brand: Brand): string | null {
  const fromFacts = safePublicUrl(brand.facts?.booking_link ?? null);
  if (fromFacts) return fromFacts;
  return safePublicUrl(brand.offers?.booking_link ?? null);
}

/** Ad click-through: booking → website → Facebook Page. */
export function resolveAdDestinationUrl(brand: Brand): string {
  return (
    resolveDestinationLink(brand) ??
    safePublicUrl(brand.website) ??
    (brand.fb_page_id ? `https://facebook.com/${brand.fb_page_id}` : "https://facebook.com/")
  );
}

export function getPendingDestinationLink(brand: Brand): PendingDestinationLink | null {
  return brand.facts?.pending_destination_link ?? null;
}

export function looksLikeDestinationLinkIntent(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  return (
    /\b(book(ing)?\s*link|booking\s*page|appointment\s*link)\b/i.test(body) ||
    /\b(put|add|include|attach|use)\b.{0,40}\b(link|url|booking)\b/i.test(body) ||
    /\b(link|url)\b.{0,40}\b(to|for)\b.{0,40}\b(book|booking|appoint)/i.test(body) ||
    /\b(post|caption|ad|story|reel).{0,40}\b(with|linked to|linking)\b.{0,40}\b(book|booking|link)/i.test(
      body,
    ) ||
    /\bwhat('s| is)\s+(our|my|the)\s+booking\s+link\b/i.test(body) ||
    /\b(update|change|set)\s+(our|my|the)\s+booking\s+link\b/i.test(body) ||
    /\bfind\s+(our|my|the)\s+(booking|book)\s*(link|page|url)?\b/i.test(body)
  );
}

export function looksLikeLinkConfirmYes(body: string): boolean {
  return /^\s*(yes|yep|yeah|yup|correct|right|that'?s?\s*(it|right|correct)|use\s+that|confirm)\b/i.test(
    body,
  );
}

export function looksLikeLinkConfirmNo(body: string): boolean {
  return /^\s*(no|nope|wrong|not\s+that|cancel|never\s*mind|nah)\b/i.test(body);
}

/** Pull a bare http(s) URL from owner SMS (corrected link during confirm). */
export function extractUrlFromMessage(body: string): string | null {
  const m =
    body.match(/https?:\/\/[^\s<>"']+/i) ??
    body.match(/\b(?:www\.)?[a-z0-9][-a-z0-9.]*\.[a-z]{2,}(?:\/[^\s<>"']*)?/i);
  if (!m) return null;
  return safePublicUrl(m[0].replace(/[.,;:!?)]+$/, ""));
}

function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isBlockedHost(u.hostname)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function scoreCandidate(url: string, anchorText: string): DiscoveredLink | null {
  const safe = safePublicUrl(url);
  if (!safe) return null;
  let score = 0;
  const reasons: string[] = [];
  try {
    const u = new URL(safe);
    if (BOOKING_HOST_RE.test(u.hostname)) {
      score += 50;
      reasons.push("known booking host");
    }
    if (BOOKING_PATH_RE.test(u.pathname)) {
      score += 35;
      reasons.push("booking path");
    }
    if (BOOKING_TEXT_RE.test(anchorText) || BOOKING_TEXT_RE.test(u.href)) {
      score += 20;
      reasons.push("booking wording");
    }
    if (/\/contact/i.test(u.pathname)) score += 5;
  } catch {
    return null;
  }
  if (score < 20) return null;
  return { url: safe, score, reason: reasons.join(", ") || "heuristic" };
}

function extractAnchors(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }
    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    const text = m[2]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
    out.push({ href: abs, text });
  }
  return out;
}

async function fetchHtml(url: string): Promise<string | null> {
  const safe = safePublicUrl(url);
  if (!safe) return null;
  try {
    const res = await fetch(safe, {
      redirect: "follow",
      headers: { "User-Agent": "KipBot/1.0 (+https://kip.social)", Accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

/** Crawl website homepage + common booking paths; return ranked candidates. */
export async function discoverBookingLinks(
  website: string | null | undefined,
): Promise<DiscoveredLink[]> {
  const base = safePublicUrl(website);
  if (!base) return [];

  const byUrl = new Map<string, DiscoveredLink>();
  const add = (c: DiscoveredLink | null) => {
    if (!c) return;
    const prev = byUrl.get(c.url);
    if (!prev || c.score > prev.score) byUrl.set(c.url, c);
  };

  const origins = new Set<string>([base]);
  try {
    const u = new URL(base);
    for (const p of DEFAULT_PATHS) origins.add(new URL(p, `${u.origin}/`).toString());
  } catch {
    /* ignore */
  }

  for (const pageUrl of origins) {
    const html = await fetchHtml(pageUrl);
    if (!html) continue;
    add(scoreCandidate(pageUrl, pageUrl));
    for (const a of extractAnchors(html, pageUrl)) {
      add(scoreCandidate(a.href, a.text));
    }
  }

  return [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

async function patchFacts(brandId: string, facts: BusinessFacts): Promise<void> {
  await query(`update brands set facts = $1::jsonb, updated_at = now() where id = $2`, [
    JSON.stringify(facts),
    brandId,
  ]);
}

async function patchOffers(brandId: string, offers: BrandOffers): Promise<void> {
  await query(`update brands set offers = $1::jsonb, updated_at = now() where id = $2`, [
    JSON.stringify(offers),
    brandId,
  ]);
}

/** Persist confirmed booking URL to both facts + offers (backward-compatible). */
export async function saveConfirmedDestinationLink(brand: Brand, url: string): Promise<Brand> {
  const safe = safePublicUrl(url);
  if (!safe) throw new Error("saveConfirmedDestinationLink: invalid url");
  const facts: BusinessFacts = {
    ...(brand.facts ?? {}),
    booking_link: safe,
    pending_destination_link: null,
  };
  const offers: BrandOffers = { ...(brand.offers ?? {}), booking_link: safe };
  await patchFacts(brand.id, facts);
  await patchOffers(brand.id, offers);
  return { ...brand, facts, offers };
}

export async function clearPendingDestinationLink(brand: Brand): Promise<Brand> {
  const facts: BusinessFacts = { ...(brand.facts ?? {}), pending_destination_link: null };
  await patchFacts(brand.id, facts);
  return { ...brand, facts };
}

export async function setPendingDestinationLink(
  brand: Brand,
  pending: PendingDestinationLink,
): Promise<Brand> {
  const facts: BusinessFacts = { ...(brand.facts ?? {}), pending_destination_link: pending };
  await patchFacts(brand.id, facts);
  return { ...brand, facts };
}

export function confirmationSms(url: string, context?: DestinationLinkContext): string {
  const why =
    context === "ads"
      ? "for ad clicks"
      : context === "story"
        ? "for this Story"
      : context === "onboarding" || context === "update"
          ? "as your booking link"
          : "for this post";
  return (
    `Is this the right link ${why}?\n${url}\n\n` +
    `Reply "yes" to use it, send the correct URL, or "no" to skip.`
  );
}

/**
 * Ensure we have a confirmed destination link. When missing, discover + ask.
 * Returns ready url, or a pending SMS the caller should send (and pause).
 */
export async function ensureDestinationLink(
  brand: Brand,
  context: DestinationLinkContext = "post",
): Promise<{ brand: Brand; url: string | null; askSms: string | null }> {
  const existing = resolveDestinationLink(brand);
  if (existing) return { brand, url: existing, askSms: null };

  const pending = getPendingDestinationLink(brand);
  if (pending?.url) {
    return { brand, url: null, askSms: confirmationSms(pending.url, context) };
  }

  const found = await discoverBookingLinks(brand.website);
  const top = found[0];
  if (!top) {
    return {
      brand,
      url: null,
      askSms:
        "I couldn't find a booking page on your website. Send me the URL to use " +
        "(e.g. your Calendly / book-now link), and I'll confirm it before adding it.",
    };
  }

  const next = await setPendingDestinationLink(brand, {
    url: top.url,
    candidates: found.slice(1, 4).map((c) => c.url),
    context,
    requested_at: new Date().toISOString(),
  });
  return { brand: next, url: null, askSms: confirmationSms(top.url, context) };
}

/**
 * Handle owner reply while a destination link confirmation is pending.
 * Returns null when this message is not a confirm/correct/cancel for the pending link.
 */
export async function handleDestinationLinkConfirmation(
  brand: Brand,
  body: string,
): Promise<{ brand: Brand; reply: string; confirmedUrl: string | null } | null> {
  const pending = getPendingDestinationLink(brand);
  if (!pending?.url) return null;

  const corrected = extractUrlFromMessage(body);

  if (looksLikeLinkConfirmYes(body) && (!corrected || corrected === pending.url)) {
    const saved = await saveConfirmedDestinationLink(brand, pending.url);
    return {
      brand: saved,
      reply: `Got it — saved ${pending.url} as your booking link. I'll use it on posts and ads when you ask.`,
      confirmedUrl: pending.url,
    };
  }

  if (corrected && corrected !== pending.url) {
    const next = await setPendingDestinationLink(brand, {
      url: corrected,
      candidates: pending.candidates,
      context: pending.context,
      requested_at: new Date().toISOString(),
    });
    return {
      brand: next,
      reply: confirmationSms(corrected, (pending.context as DestinationLinkContext) ?? "update"),
      confirmedUrl: null,
    };
  }

  if (looksLikeLinkConfirmNo(body) && !corrected) {
    const cleared = await clearPendingDestinationLink(brand);
    return {
      brand: cleared,
      reply: 'Okay, skipped. Send me the right booking URL anytime (or say "find our booking link").',
      confirmedUrl: null,
    };
  }

  return null;
}

/** Platforms that must not put raw URLs in the caption (IG feed/Reels/Stories). */
export function platformForbidsCaptionUrl(
  platform: Platform | string,
  _format?: PostFormat | string | null,
): boolean {
  return platform === "instagram";
}

export function defaultLinkKeyword(): string {
  return DEFAULT_KEYWORD;
}

export function buildLinkOffer(opts: {
  url: string;
  platform: Platform | string;
  format?: PostFormat | string | null;
  keyword?: string;
}): LinkOffer {
  const url = safePublicUrl(opts.url);
  if (!url) throw new Error("buildLinkOffer: invalid url");
  const keyword = (opts.keyword ?? DEFAULT_KEYWORD).toUpperCase();
  const confirmed_at = new Date().toISOString();
  if (opts.format === "story") {
    return { url, mode: "story_cta", keyword, confirmed_at };
  }
  if (platformForbidsCaptionUrl(opts.platform, opts.format) || opts.platform === "linkedin") {
    return { url, mode: "comment_dm", keyword, confirmed_at };
  }
  return { url, mode: "caption_url", confirmed_at };
}

const URL_IN_TEXT_RE = /https?:\/\/\S+/gi;

/** Strip raw URLs from IG captions and append a comment/DM CTA when offering a link. */
export function applyLinkOfferToCaption(
  caption: string,
  offer: LinkOffer | null | undefined,
  platform: Platform | string,
  format?: PostFormat | string | null,
): string {
  if (!offer?.url) return caption;
  let text = caption.trim();

  if (offer.mode === "comment_dm" || platformForbidsCaptionUrl(platform, format)) {
    text = text
      .replace(URL_IN_TEXT_RE, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const keyword = offer.keyword ?? DEFAULT_KEYWORD;
    const cta = `Comment ${keyword} and I'll DM you the link.`;
    if (!new RegExp(`comment\\s+${keyword}\\b`, "i").test(text)) {
      text = text ? `${text}\n\n${cta}` : cta;
    }
    return text;
  }

  if (offer.mode === "story_cta") {
    // Meta Content Publishing API cannot attach Story link stickers — CTA is baked
    // into creative; caption (if any) must not claim a tappable sticker URL.
    return text.replace(URL_IN_TEXT_RE, "").trim();
  }

  if (offer.mode === "caption_url") {
    if (!text.includes(offer.url)) {
      text = text ? `${text}\n\n${offer.url}` : offer.url;
    }
    if (platform === "linkedin" && !/dm me|comment|bio/i.test(text)) {
      text =
        `${text}\n\nPrefer a DM? Comment ${offer.keyword ?? DEFAULT_KEYWORD} and I'll send it over (also in bio).`;
    }
    return text;
  }

  return text;
}

export function storyLinkCta(offer: LinkOffer | null | undefined): string {
  const keyword = offer?.keyword ?? DEFAULT_KEYWORD;
  return `DM me or comment ${keyword} for the link`;
}

/** True when comment/DM text is asking for the post's offered link. */
export function matchesLinkOfferRequest(
  text: string | null | undefined,
  offer: LinkOffer,
): boolean {
  if (!text?.trim()) return false;
  const raw = text.trim();
  const keyword = (offer.keyword ?? DEFAULT_KEYWORD).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s*${keyword}\\s*[!.]*\\s*$`, "i").test(raw)) return true;
  if (new RegExp(`\\b${keyword}\\b`, "i").test(raw) && raw.length <= 40) return true;
  return /\b(link|url|book|booking|schedule|appoint|send\s+(it|me)|dm\s+me)\b/i.test(raw);
}

export async function loadPostForInteraction(interaction: {
  brand_id: string;
  post_id?: string | null;
  media_external_id?: string | null;
}): Promise<Post | null> {
  if (interaction.post_id) {
    return queryOne<Post>(`select * from posts where id = $1 and brand_id = $2`, [
      interaction.post_id,
      interaction.brand_id,
    ]);
  }
  if (interaction.media_external_id) {
    return queryOne<Post>(
      `select * from posts
        where brand_id = $1
          and external_post_id = $2
          and link_offer is not null
        order by published_at desc nulls last
        limit 1`,
      [interaction.brand_id, interaction.media_external_id],
    );
  }
  return queryOne<Post>(
    `select * from posts
      where brand_id = $1
        and link_offer is not null
        and status = 'published'
        and published_at > now() - interval '14 days'
      order by published_at desc
      limit 1`,
    [interaction.brand_id],
  );
}

export function privateLinkDmBody(brand: Brand, url: string): string {
  return `Here's the link for ${brand.name}: ${url}`;
}

export function publicLinkAckReply(keyword?: string): string {
  const k = keyword ?? DEFAULT_KEYWORD;
  return `Sent you a DM with the link (comment ${k} anytime)`;
}
