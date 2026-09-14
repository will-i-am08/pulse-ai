/**
 * Public instant demo: paste a website → sample Kip posts (not publishable).
 */
import { randomBytes } from "node:crypto";
import {
  query,
  queryOne,
  sanitizeChatText,
  type VisualProfile,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { readWebsite, extractVisualHintsFromHtml } from "./onboarding.js";
import { resolveLookPackFromNiche, type LookPackId } from "./lookPacks/index.js";
import { renderQuoteCard } from "./imaging.js";

export type DemoSample = {
  caption: string;
  headline: string;
  /** JPEG as base64 (data URL built by the page). */
  imageBase64: string;
};

export type DemoSession = {
  id: string;
  slug: string;
  url: string;
  brand_name: string | null;
  summary: string | null;
  look_pack: string | null;
  samples: DemoSample[];
  creator_ip: string | null;
  expires_at: string;
  created_at: string;
};

const DEMO_TTL_HOURS = 48;
const DEMO_MAX_PER_IP_HOUR = 5;

function mintSlug(): string {
  return randomBytes(5).toString("hex"); // 10 hex chars
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("Enter a website URL");
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function countRecentDemosForIp(ip: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from demo_sessions
      where creator_ip = $1 and created_at > now() - interval '1 hour'`,
    [ip],
  );
  return Number(row?.n ?? 0);
}

async function draftDemoCaptions(
  brandName: string,
  summary: string,
  packLabel: string,
): Promise<Array<{ caption: string; headline: string }>> {
  const raw = await callLLM({
    system:
      "You write sample Instagram captions for a local business demo. Output ONLY JSON: " +
      '{"posts":[{"headline":"2-5 ALL CAPS words","caption":"1-3 sentence caption in a warm matey voice, no hashtag spam"}]} — exactly 3 posts. No markdown.',
    messages: [
      {
        role: "user",
        content: `Brand: ${brandName}\nLook: ${packLabel}\nSummary:\n${summary}\n\nWrite 3 sample posts.`,
      },
    ],
    maxTokens: 500,
  });
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      posts?: Array<{ caption?: string; headline?: string }>;
    };
    const posts = (json.posts ?? [])
      .map((p) => ({
        headline: sanitizeChatText(String(p.headline ?? "THIS WEEK")).toUpperCase().slice(0, 42),
        caption: sanitizeChatText(String(p.caption ?? "")).slice(0, 400),
      }))
      .filter((p) => p.caption.length > 10)
      .slice(0, 3);
    if (posts.length >= 2) return posts;
  } catch {
    /* fall through */
  }
  return [
    {
      headline: "THIS WEEK",
      caption: `${brandName} — a quick look at what we'd post for you. Nothing goes live without your yes.`,
    },
    {
      headline: "BEHIND THE SCENES",
      caption: `A warmer cut of the same story — Kip drafts in your voice so you just reply yes.`,
    },
    {
      headline: "COME THROUGH",
      caption: `Soft CTA energy for locals. Text Kip a photo and this becomes your real feed.`,
    },
  ];
}

function inferBrandName(url: string, summary: string, html: string): string {
  const og =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
  if (og?.trim()) return og.trim().slice(0, 60);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  if (title && title.length < 60) return title.replace(/\s*[|\-–].*$/, "").trim();
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0]!.replace(/-/g, " ");
  } catch {
    return summary.slice(0, 40) || "Your brand";
  }
}

/**
 * Create a public demo session from a website URL.
 * Returns the slug for /d/{slug}.
 */
export async function createDemoSession(opts: {
  url: string;
  creatorIp?: string | null;
}): Promise<{ slug: string } | { error: string }> {
  const ip = opts.creatorIp?.trim() || null;
  if (ip) {
    const n = await countRecentDemosForIp(ip);
    if (n >= DEMO_MAX_PER_IP_HOUR) {
      return { error: "Too many demos from this network — try again in an hour." };
    }
  }

  let url: string;
  try {
    url = normalizeUrl(opts.url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Enter a website URL" };
  }

  const site = await readWebsite(url);
  if (!site) {
    return { error: "Couldn't read that site — check the URL and try again." };
  }

  const hints = extractVisualHintsFromHtml(site.html, url);
  const brandName = inferBrandName(url, site.summary, site.html);
  const pack = resolveLookPackFromNiche(`${brandName} ${site.summary}`);
  const visual: VisualProfile = {
    colors: hints.theme_colors.slice(0, 3),
    fonts: hints.fonts.slice(0, 2),
    logo_url: hints.logo_url,
    aesthetic: pack.label,
    photo_treatment: pack.baseDirection.slice(0, 120),
  };

  const drafts = await draftDemoCaptions(brandName, site.summary, pack.label);
  const samples: DemoSample[] = [];
  for (const d of drafts) {
    try {
      const buf = await renderQuoteCard(d.headline, brandName, visual);
      samples.push({
        caption: d.caption,
        headline: d.headline,
        imageBase64: buf.toString("base64"),
      });
    } catch (err) {
      console.error("demo sample render failed", err);
    }
  }
  if (samples.length === 0) {
    return { error: "Couldn't generate sample posts — try again in a minute." };
  }

  const slug = mintSlug();
  const expires = new Date(Date.now() + DEMO_TTL_HOURS * 60 * 60 * 1000);
  await query(
    `insert into demo_sessions (slug, url, brand_name, summary, look_pack, samples, creator_ip, expires_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      slug,
      url,
      brandName,
      site.summary.slice(0, 2000),
      pack.id as LookPackId,
      JSON.stringify(samples),
      ip,
      expires.toISOString(),
    ],
  );
  return { slug };
}

export async function getDemoSession(slug: string): Promise<DemoSession | null> {
  const row = await queryOne<DemoSession>(
    `select * from demo_sessions where slug = $1 and expires_at > now()`,
    [slug.trim().toLowerCase()],
  );
  if (!row) return null;
  const samples = Array.isArray(row.samples) ? row.samples : [];
  return { ...row, samples };
}

/** Parse slug from either raw slug or full /d/ path. */
export function normalizeDemoSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\/d\//, "").replace(/[^a-z0-9]/g, "");
}
